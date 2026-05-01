/**
 * Drain loop — pulls pending ops out of IDB and POSTs them to the server.
 *
 * Three triggers move ops:
 *   1. `scheduleDrainSoon()` — called from outbox.enqueueWrite() on each
 *      new op. Throttled to one drain per 250 ms so a quick string of
 *      enqueues doesn't flood.
 *   2. `online` window event — when the browser reconnects, drain
 *      everything that piled up while offline.
 *   3. 15-second interval — universal fallback for environments where
 *      Background Sync isn't available (WebKitGTK in Phase 3 Tauri).
 *
 * Per op:
 *   - tryClaim flips status pending → inflight (atomic in Dexie)
 *   - POST to op.endpoint with op.payload
 *   - 2xx               → markDone (delete row)
 *   - 4xx               → markFailed (no auto-retry; bad payload)
 *   - 5xx / network err → rescheduleForRetry with exponential backoff
 *                         (1s → 2s → 4s … 60s cap, 10 attempts then failed)
 *
 * Idempotency on the server (Hard Rule #15) means duplicate POSTs are
 * safe — if a tab dies mid-fetch, the next attempt with the same ULID
 * no-ops on the server.
 */

import {
  countByStatus,
  listPending,
  markDone,
  markFailed,
  notifyOpDone,
  rescheduleForRetry,
  reclaimOrphanedInflight,
  tryClaim,
} from './outbox';

const MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;
const SOON_THROTTLE_MS = 250;
const INTERVAL_MS = 15_000;

let drainInFlight: Promise<void> | null = null;
let soonTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let installed = false;

export interface DrainReport {
  attempted: number;
  succeeded: number;
  failed: number;
  retried: number;
}

/**
 * Drain everything that's currently `pending` and past its `nextAttemptAt`.
 * Concurrent calls coalesce — only one drain runs at a time.
 */
export function drainOnce(): Promise<DrainReport> {
  if (drainInFlight) return drainInFlight.then(() => ({ attempted: 0, succeeded: 0, failed: 0, retried: 0 }));
  drainInFlight = (async () => {
    const ops = await listPending('pending');
    const now = Date.now();
    const due = ops.filter((op) => op.nextAttemptAt == null || op.nextAttemptAt <= now);
    for (const op of due) {
      const claimed = await tryClaim(op.id);
      if (!claimed) continue;
      try {
        const res = await fetch(op.endpoint, {
          method: op.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
        if (res.ok) {
          // Capture the parsed JSON response so subscribers (e.g. PosScreen)
          // can update their UI with server-canonical fields — most
          // importantly the daily-reset receiptNumber that doesn't exist
          // until /api/sales has run. Body parse may fail on a 204; that's
          // fine, we still markDone with no payload.
          let response: unknown = null;
          try { response = await res.json(); } catch { /* no body */ }
          notifyOpDone(op.id, response);
          await markDone(op.id);
        } else if (res.status >= 400 && res.status < 500) {
          // 4xx → bad payload. Don't retry; surface to OWNER for review.
          let message = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) message = String(body.error);
          } catch { /* keep status-only message */ }
          await markFailed(op.id, message);
        } else {
          // 5xx → server hiccup; retry with backoff.
          const attempts = op.attemptCount + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await markFailed(op.id, `HTTP ${res.status} after ${attempts} attempts`);
          } else {
            const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts - 1), BACKOFF_CAP_MS);
            await rescheduleForRetry(op.id, `HTTP ${res.status}`, delay);
          }
        }
      } catch (e) {
        // Network error — treat like a 5xx and back off.
        const attempts = op.attemptCount + 1;
        const message = (e as Error).message ?? 'network';
        if (attempts >= MAX_ATTEMPTS) {
          await markFailed(op.id, `${message} after ${attempts} attempts`);
        } else {
          const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts - 1), BACKOFF_CAP_MS);
          await rescheduleForRetry(op.id, message, delay);
        }
      }
    }
  })();
  return drainInFlight.finally(() => {
    drainInFlight = null;
    return countByStatus().then(() => ({ attempted: 0, succeeded: 0, failed: 0, retried: 0 }));
  }) as Promise<DrainReport>;
}

/**
 * Throttle: at most one drain triggered per 250 ms. The throttle window
 * means a string of pay clicks doesn't fire 5 separate drains; the trailing
 * one runs and picks up everything queued during the window.
 */
export function scheduleDrainSoon(): void {
  if (typeof window === 'undefined') return;
  if (soonTimer) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void drainOnce();
  }, SOON_THROTTLE_MS);
}

/**
 * Install the drain loop. Idempotent. Returns a teardown closure.
 *
 * Boot housekeeping: any `inflight` rows left from a tab crash are
 * reclaimed back to `pending` so the next pass picks them up.
 */
export function startDrainLoop(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  void reclaimOrphanedInflight().then((n) => {
    if (n > 0) console.info(`[drain] reclaimed ${n} orphaned inflight ops`);
  });

  const onOnline = () => { scheduleDrainSoon(); };
  window.addEventListener('online', onOnline);

  // Allow the service worker (Phase 3-ready) to nudge us via postMessage.
  const onMsg = (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type === 'drain-now') scheduleDrainSoon();
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onMsg);
  }

  intervalTimer = setInterval(() => { void drainOnce(); }, INTERVAL_MS);
  // Fire one drain on install for any ops queued from a prior session.
  scheduleDrainSoon();

  return () => {
    window.removeEventListener('online', onOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', onMsg);
    }
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
    installed = false;
  };
}
