/**
 * Local browser persistence for the offline-first cashier.
 *
 * Three stores:
 *   - pendingOps  → outbox queue for writes (sales / production / receive / adjust)
 *   - catalog     → SWR cache of items+modifiers+categories (one row per tenant slug)
 *   - meta        → arbitrary kv (lastSync, cachedMode, lastEtag, etc.)
 *
 * Why Dexie: it gives us a typed Promise API over IndexedDB, automatic schema
 * migrations, and atomic transactions across stores. Phase 2's drain loop
 * needs `markInflight + markDone` to be atomic — Dexie transactions handle
 * that for free.
 *
 * Database name `pky-local`, version 1. Bump version + add an upgrader if
 * we ever need to add a store or index.
 */

import Dexie, { type Table } from 'dexie';
import type { InventoryMode } from '@/lib/featureMode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpStatus = 'pending' | 'inflight' | 'failed';

export interface PendingOp {
  /** ULID — same id sent in the request body (idempotency contract) */
  id: string;
  /** e.g. '/api/sales' */
  endpoint: string;
  method: 'POST';
  /** JSON-serialisable; the request body, already includes `id` and `modeAtCreation` */
  payload: Record<string, unknown>;
  modeAtCreation: InventoryMode;
  attemptCount: number;
  lastError: string | null;
  status: OpStatus;
  createdAt: number;
  lastAttemptAt: number | null;
  /** Backoff scheduling — set when status='pending' and attempts > 0 */
  nextAttemptAt: number | null;
}

export interface CatalogEntry {
  /** key — tenant slug; cashier rarely switches tenants */
  tenantSlug: string;
  etag: string;
  fetchedAt: number;
  /** raw payload from /api/catalog — see lib/repos/catalog.ts for shape */
  payload: unknown;
}

export interface MetaRow {
  key: string;
  value: unknown;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Dexie definition
// ---------------------------------------------------------------------------

class PaeKaYaukLocalDb extends Dexie {
  pendingOps!: Table<PendingOp, string>;
  catalog!: Table<CatalogEntry, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('pky-local');
    this.version(1).stores({
      // [status+createdAt] = compound index, drives ordered fetches by state.
      // 'endpoint' = secondary lookup for stats by route.
      pendingOps: 'id, [status+createdAt], endpoint, status',
      catalog: 'tenantSlug',
      meta: 'key',
    });
  }
}

/**
 * Lazy singleton — Dexie opens the DB on first table access. Importing this
 * module on the server is a no-op; the actual DB only materializes when a
 * client component accesses a store.
 */
let _db: PaeKaYaukLocalDb | null = null;
export function db(): PaeKaYaukLocalDb {
  if (typeof window === 'undefined') {
    throw new Error('lib/client/db.ts is browser-only — guard server callers');
  }
  if (!_db) _db = new PaeKaYaukLocalDb();
  return _db;
}

// ---------------------------------------------------------------------------
// Tiny meta helpers — used by drain + catalog modules
// ---------------------------------------------------------------------------

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const row = await db().meta.get(key);
  return (row?.value as T) ?? null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value, updatedAt: Date.now() });
}
