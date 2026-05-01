/**
 * Shared Neon HTTP client for hot-path queries, with automatic retry.
 *
 * Why retry: Neon's free-tier compute autosuspends after ~5 min idle. The
 * first query after suspend often throws "fetch failed" / ETIMEDOUT before
 * the wake-up completes. Retrying 3× with backoff gives the compute time
 * to come online. This is transparent to callers.
 *
 * Used for:
 *   - Auth checks (every page load)
 *   - Tenant resolution
 *   - POS ring / sync (offline-critical)
 *   - Any single-query read/write where reliability matters
 *
 * Prisma + WebSocket adapter remains available for transactional work.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url && typeof window === 'undefined') {
  console.warn('[neonHttp] DATABASE_URL is not set at module load');
}

// Underlying driver — the `neon()` function is callable both as a tag (sql`...`)
// and directly (sql(text, params)). Both go through our Proxy wrapper below.
const rawSql = neon(url ?? '');

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

const RETRY_ATTEMPTS = 4;       // 1 initial + 3 retries
const RETRY_BASE_MS = 400;      // 400ms, 800ms, 1600ms → ~2.8s total worst case

function isTransient(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enetunreach') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted') ||
    // Neon-specific wake-up errors
    msg.includes('endpoint is disabled') ||
    msg.includes('compute is suspended') ||
    msg.includes('no response from compute')
  );
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = isTransient(e);
      if (!transient || attempt === RETRY_ATTEMPTS - 1) break;
      const wait = RETRY_BASE_MS * Math.pow(2, attempt);
      console.warn(
        `[neonHttp] transient error on attempt ${attempt + 1}/${RETRY_ATTEMPTS}, retrying in ${wait}ms:`,
        (e as Error).message
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Proxy the callable so both forms get retry automatically:
//   sql`SELECT ...`         (tagged template)
//   sql(text, params)       (direct call)
// ---------------------------------------------------------------------------

export const sql = new Proxy(rawSql, {
  apply(target, thisArg, args) {
    return withRetry(() => Reflect.apply(target as (...a: unknown[]) => Promise<unknown>, thisArg, args));
  },
}) as NeonQueryFunction<false, false>;
