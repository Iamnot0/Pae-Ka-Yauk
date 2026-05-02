/**
 * Shared SQL client for hot-path queries, with automatic retry.
 *
 * Auto-selects driver from DATABASE_URL:
 *   - localhost / 127.0.0.1   → node-postgres (Postgres wire protocol)
 *     used by the cashier station's local Postgres (Sprint deploy plan).
 *   - anything else (neon.tech) → @neondatabase/serverless (HTTP)
 *     used by the Vercel deployment talking to Neon over port 443.
 *
 * Both drivers expose the same callable surface and return Array<row>:
 *   sql(text, params)        // function form
 *   sql`SELECT ${value}`     // tagged-template form
 *
 * Why retry: Neon's free-tier compute autosuspends after ~5 min idle. The
 * first query after suspend often throws "fetch failed" / ETIMEDOUT before
 * the wake-up completes. Retrying 3× with backoff gives the compute time
 * to come online. Same wrapper benefits node-postgres against transient
 * pool/connection blips.
 *
 * Used for: auth, tenant resolution, POS ring/sync, any read/write where
 * reliability matters. Prisma + WebSocket adapter remains for schema push.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url && typeof window === 'undefined') {
  console.warn('[neonHttp] DATABASE_URL is not set at module load');
}

// Cashier-station deployments point DATABASE_URL at a local Postgres
// (e.g. postgresql://paekayauk:…@localhost:5432/paekayauk). The Neon HTTP
// driver only speaks Neon's REST endpoint, not the Postgres wire protocol,
// so for localhost we swap in node-postgres and present the same callable
// surface (function form + tagged-template form, returns Array<row>).
function isLocalUrl(u: string): boolean {
  return /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1|\[::1\])/i.test(u);
}

type Sql = NeonQueryFunction<false, false>;

const rawSql: Sql = (() => {
  if (!url) return neon('') as Sql;
  if (!isLocalUrl(url)) return neon(url) as Sql;

  const pool = new Pool({ connectionString: url, ssl: false });

  // Adapter mirroring `neon()`'s dual call shape:
  //   sql(text, params)        → Array<row>
  //   sql`SELECT ${value}`     → Array<row>
  const adapter = function (
    this: unknown,
    first: TemplateStringsArray | string,
    ...rest: unknown[]
  ): Promise<unknown[]> {
    if (typeof first === 'string') {
      const params = (rest[0] as unknown[] | undefined) ?? [];
      return pool.query(first, params).then((r) => r.rows);
    }
    let text = '';
    const params: unknown[] = [];
    first.forEach((chunk, i) => {
      text += chunk;
      if (i < rest.length) {
        params.push(rest[i]);
        text += `$${params.length}`;
      }
    });
    return pool.query(text, params).then((r) => r.rows);
  };
  console.info('[neonHttp] localhost DATABASE_URL detected → using node-postgres');
  return adapter as unknown as Sql;
})();

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
