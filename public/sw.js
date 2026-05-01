// Pae Ka Yauk POS — service worker
// Network-first with cache fallback for navigations, plus the Phase 2
// background-sync hook that nudges the main-thread drain.
//
// API routes bypass the cache; only GET responses from same origin are
// cached. Navigations (Accept: text/html) get a cached fallback to the POS
// shell so a cashier reloading offline lands somewhere usable instead of
// the browser's "no internet" page.

const CACHE_NAME = 'paeKaYauk-v2';

const STATIC_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept API — auth, sales, live data must be fresh.
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin requests (fonts CDN, Vercel blob) — pass through untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone()).catch(() => { /* ignore quota */ });
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Last-resort fallback for HTML navigations: serve a cached /pos
        // shell so the cashier can at least reach the local outbox UI.
        if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
          const fallback =
            (await caches.match('/pos')) ||
            (await caches.match('/login')) ||
            (await caches.match('/'));
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});

// ── Phase 2 hook: Background Sync API ──────────────────────────────────
// Chrome registers a 'pky-drain' tag from the main thread when the cashier
// queues writes while offline. The browser fires this event when the
// device regains connectivity (even if our tab is closed). All we do here
// is poke open clients — the real drain runs in lib/client/drain.ts so
// the auth cookie is on the request.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'pky-drain') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) c.postMessage({ type: 'drain-now' });
    })
  );
});

// ── postMessage channel: main thread asks SW to schedule background sync.
// Fire-and-forget — if the platform doesn't support it (WebKitGTK), we
// silently fall back to the 15s polling drain.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'register-sync' && self.registration && self.registration.sync) {
    self.registration.sync.register('pky-drain').catch(() => { /* unsupported */ });
  }
});
