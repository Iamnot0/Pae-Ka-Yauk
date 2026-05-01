/**
 * Catalog SWR client — gives the POS UI an instant render from IDB plus
 * a background refresh against `/api/catalog`. Three triggers nudge the
 * refresh: mount, the browser's `online` event, and a 60-second interval.
 *
 * Stale-while-revalidate semantics:
 *   1. POS calls getCatalogLocal() on mount — instant, never blocks.
 *   2. POS calls refreshCatalog() in the background.
 *      - 304 → no-op, listener not fired.
 *      - 200 → write fresh row to IDB, fire `onCatalogUpdate` listeners.
 *
 * Hard Rule #5 covers the safety case: `/api/sales` re-looks-up canonical
 * prices server-side. A stale catalog can therefore only show a stale
 * price; the recorded sale is always the current server price.
 */

import { db, type CatalogEntry, getMeta, setMeta } from './db';

const TENANT_KEY = 'tenantSlug';
const ETAG_KEY = 'catalog.etag';

// ---------------------------------------------------------------------------
// Listener bus — POS subscribes; catalog edits fire after a successful 200.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function onCatalogUpdate(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify(): void {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.error('[catalog listener]', e); }
  }
}

// ---------------------------------------------------------------------------
// Tenant scope — a cashier rarely switches tenants, but we still key the
// IDB row by slug so a tenant flip doesn't poison the cache.
// ---------------------------------------------------------------------------

let cachedSlug: string | null = null;

/**
 * Caller (e.g. a layout) hands us the tenant slug at mount. We persist it
 * so subsequent reads on the same browser pick up where we left off.
 */
export async function setTenantSlug(slug: string): Promise<void> {
  cachedSlug = slug;
  await setMeta(TENANT_KEY, slug);
}

async function getTenantSlug(): Promise<string | null> {
  if (cachedSlug) return cachedSlug;
  const stored = await getMeta<string>(TENANT_KEY);
  cachedSlug = stored;
  return stored;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCatalogLocal(): Promise<CatalogEntry | null> {
  const slug = await getTenantSlug();
  if (!slug) return null;
  return (await db().catalog.get(slug)) ?? null;
}

export interface RefreshResult {
  updated: boolean;
  status: 200 | 304 | 'error';
  errorMessage?: string;
}

/**
 * Hit `/api/catalog` with the stored ETag. Returns `{ updated: true }` only
 * when the server replied 200 with a different payload than we already had.
 *
 * Errors don't throw — the cashier already has a stale-but-usable cache.
 */
export async function refreshCatalog(): Promise<RefreshResult> {
  if (typeof window === 'undefined') {
    return { updated: false, status: 'error', errorMessage: 'server-side call' };
  }
  const slug = await getTenantSlug();
  if (!slug) return { updated: false, status: 'error', errorMessage: 'no tenant slug' };

  const lastEtag = (await getMeta<string>(ETAG_KEY)) ?? '';
  try {
    const res = await fetch('/api/catalog', {
      headers: lastEtag ? { 'If-None-Match': `"${lastEtag}"` } : {},
      // Avoid Next's RSC cache for this fetch — we manage caching ourselves.
      cache: 'no-store',
    });
    if (res.status === 304) {
      return { updated: false, status: 304 };
    }
    if (!res.ok) {
      return { updated: false, status: 'error', errorMessage: `HTTP ${res.status}` };
    }
    const etag = (res.headers.get('ETag') ?? '').replace(/^"|"$/g, '');
    const payload = await res.json();
    const entry: CatalogEntry = {
      tenantSlug: slug,
      etag,
      fetchedAt: Date.now(),
      payload,
    };
    await db().catalog.put(entry);
    await setMeta(ETAG_KEY, etag);
    notify();
    return { updated: true, status: 200 };
  } catch (e) {
    return { updated: false, status: 'error', errorMessage: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Loop wiring — components mount this once at app boot.
// ---------------------------------------------------------------------------

let loopInstalled = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Install the SWR loop. Idempotent — calling twice is a no-op. Returns a
 * teardown closure for tests.
 */
export function startCatalogSwrLoop(): () => void {
  if (loopInstalled || typeof window === 'undefined') return () => {};
  loopInstalled = true;

  const fire = () => { void refreshCatalog(); };

  // Trigger 1 — fire once on install (mount).
  fire();

  // Trigger 2 — re-fire when the browser regains connectivity.
  const onOnline = () => fire();
  window.addEventListener('online', onOnline);

  // Trigger 3 — 60-second tick. Cheap because most calls 304.
  intervalId = setInterval(fire, 60_000);

  return () => {
    window.removeEventListener('online', onOnline);
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    loopInstalled = false;
  };
}
