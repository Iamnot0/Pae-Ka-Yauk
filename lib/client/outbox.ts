/**
 * Outbox API — the cashier's local write queue.
 *
 * Every cashier-side write (sale, production, stock adjust, receive) goes
 * here first. The drain loop (lib/client/drain.ts) picks ops up and POSTs
 * them to the server. Because every write endpoint is idempotent on the
 * client-minted ULID (Hard Rule #15), retries are safe by design — the
 * second attempt with the same id no-ops on the server.
 *
 * Contract guarantees:
 *   - enqueueWrite() returns synchronously after a single Dexie put().
 *     The op already has its server ULID; the slip can render immediately.
 *   - markInflight + markDone use the same Dexie transaction, so a tab close
 *     mid-drain leaves the op in `inflight` (cleaned up on next boot).
 *   - failed ops stay in the table. The OWNER's SyncStatusPill panel surfaces
 *     them with retry/discard actions.
 */

import { db, type PendingOp, type OpStatus } from './db';
import { newId } from './ulid';
import type { InventoryMode } from '@/lib/featureMode';

// ---------------------------------------------------------------------------
// Listener bus — SyncStatusPill + TodaysSalesPanel subscribe so the UI
// updates instantly without polling. Plain Set; no React state hooks here
// because outbox needs to be callable from non-React modules (drain loop).
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function onOutboxChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify(): void {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.error('[outbox listener]', e); }
  }
}

// ---------------------------------------------------------------------------
// Cached mode — drain stamps `modeAtCreation` from local cache so a write
// queued offline retains the policy that was active when the cashier rang
// it up, not the policy at sync time.
// ---------------------------------------------------------------------------

let cachedMode: InventoryMode = 'POS_PAUSED';
export function setCachedMode(m: InventoryMode): void { cachedMode = m; }
export function getCachedMode(): InventoryMode { return cachedMode; }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  /**
   * If the caller wants to control the ULID (e.g. POS already minted one
   * at line-add time), pass it. Otherwise we mint a fresh one.
   */
  id?: string;
}

/**
 * Enqueue a write. Returns the persisted op so the caller can render
 * receipts / UI from the same payload that will hit the server.
 */
export async function enqueueWrite(
  endpoint: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<PendingOp> {
  const id = opts.id ?? newId();
  const op: PendingOp = {
    id,
    endpoint,
    method: 'POST',
    payload: { ...payload, id, modeAtCreation: cachedMode },
    modeAtCreation: cachedMode,
    attemptCount: 0,
    lastError: null,
    status: 'pending',
    createdAt: Date.now(),
    lastAttemptAt: null,
    nextAttemptAt: null,
  };
  await db().pendingOps.put(op);
  notify();
  // Lazy-import to avoid a circular module dependency at boot.
  void import('./drain').then((m) => m.scheduleDrainSoon()).catch(() => {});
  return op;
}

export async function listPending(status?: OpStatus): Promise<PendingOp[]> {
  if (status) return db().pendingOps.where('status').equals(status).sortBy('createdAt');
  return db().pendingOps.orderBy('createdAt').toArray();
}

export async function countPending(status?: OpStatus): Promise<number> {
  if (status) return db().pendingOps.where('status').equals(status).count();
  return db().pendingOps.count();
}

export async function countByStatus(): Promise<Record<OpStatus, number>> {
  const all = await db().pendingOps.toArray();
  const out: Record<OpStatus, number> = { pending: 0, inflight: 0, failed: 0 };
  for (const op of all) out[op.status]++;
  return out;
}

/**
 * Atomic claim: only flips status pending→inflight if no other tab beat us.
 * Returns true if we won the claim. The caller (drain) then POSTs.
 */
export async function tryClaim(id: string): Promise<boolean> {
  let claimed = false;
  await db().transaction('rw', db().pendingOps, async () => {
    const op = await db().pendingOps.get(id);
    if (!op || op.status !== 'pending') return;
    op.status = 'inflight';
    op.lastAttemptAt = Date.now();
    op.attemptCount++;
    await db().pendingOps.put(op);
    claimed = true;
  });
  if (claimed) notify();
  return claimed;
}

export async function markDone(id: string): Promise<void> {
  await db().pendingOps.delete(id);
  notify();
}

// ---------------------------------------------------------------------------
// Per-op response bus — drain emits the parsed server response after a 2xx
// so callers (e.g. PosScreen) can update their UI with canonical fields like
// the daily-reset receipt number that only exists server-side.
//
// Why a separate bus from the catalog/outbox `notify()`: that one fires for
// any pendingOps mutation (count changes drive the SyncStatusPill). The
// per-op bus is targeted — a sale's response goes to exactly the listener
// waiting for that sale's id.
// ---------------------------------------------------------------------------

type OpDoneListener = (id: string, response: unknown) => void;
const opDoneListeners = new Set<OpDoneListener>();

export function onOpDone(cb: OpDoneListener): () => void {
  opDoneListeners.add(cb);
  return () => { opDoneListeners.delete(cb); };
}

export function notifyOpDone(id: string, response: unknown): void {
  for (const cb of opDoneListeners) {
    try { cb(id, response); } catch (e) { console.error('[opDone listener]', e); }
  }
}

export async function markFailed(id: string, error: string): Promise<void> {
  await db().transaction('rw', db().pendingOps, async () => {
    const op = await db().pendingOps.get(id);
    if (!op) return;
    op.status = 'failed';
    op.lastError = error;
    await db().pendingOps.put(op);
  });
  notify();
}

/**
 * Reset back to `pending` with a backoff. Used after 5xx / network errors.
 */
export async function rescheduleForRetry(id: string, error: string, delayMs: number): Promise<void> {
  await db().transaction('rw', db().pendingOps, async () => {
    const op = await db().pendingOps.get(id);
    if (!op) return;
    op.status = 'pending';
    op.lastError = error;
    op.nextAttemptAt = Date.now() + delayMs;
    await db().pendingOps.put(op);
  });
  notify();
}

export async function discard(id: string): Promise<void> {
  await db().pendingOps.delete(id);
  notify();
}

/**
 * Cleanup orphan inflight ops left over from a tab crash mid-drain. Run
 * once on app boot; flips inflight → pending so the drain picks them back up.
 */
export async function reclaimOrphanedInflight(): Promise<number> {
  let n = 0;
  await db().transaction('rw', db().pendingOps, async () => {
    const orphans = await db().pendingOps.where('status').equals('inflight').toArray();
    for (const op of orphans) {
      op.status = 'pending';
      await db().pendingOps.put(op);
      n++;
    }
  });
  if (n > 0) notify();
  return n;
}
