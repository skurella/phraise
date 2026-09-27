// Brief 04, task 5: hand-written service worker, registered from the page
// (`web/src/offlineShell.ts`), that caches the app shell (HTML, JS, CSS,
// `/config.json`) so a reload with the network off still loads the page.
// localhost is a secure context, so a plain `http://127.0.0.1` origin can
// register this with no HTTPS needed.
//
// Vite build output has hashed, unpredictable chunk filenames (and code
// splits further for Mermaid/on-demand chunks), so this worker does NOT
// try to enumerate them at install time. Instead:
//  - the PAGE itself explicitly primes the cache after a successful online
//    load (`primeOfflineCache` in `offlineShell.ts`), using
//    `performance.getEntriesByType('resource')` to find every same-origin
//    URL the page actually fetched (scripts, styles, `/config.json`, and
//    its own navigation URL) -- this is deterministic and does not depend
//    on this worker's own install/activate timing racing the very first
//    page load, which a precache list would.
//  - this worker's fetch handler ALSO opportunistically caches every
//    successful same-origin GET response as a bonus/fallback, and serves
//    the cache when the network fetch fails (offline).
//
// Must stay in sync with `CACHE_NAME` in `offlineShell.ts` -- both read
// from and write to the SAME Cache Storage entry for this origin (the page
// context and this worker share one Cache Storage; the name is the only
// thing that has to match).
const CACHE_NAME = 'phraise-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Leave the relay's own protocol alone (not an http(s) fetch anyway, but
  // explicit for clarity) and anything under /api/ (not part of the shell).
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(req);
        if (response && response.ok) cache.put(req, response.clone());
        return response;
      } catch (err) {
        // Offline (or the relay/page server is unreachable): serve the
        // cached copy. `ignoreSearch` so a navigation to the same path
        // with a different-looking-but-equivalent query still matches the
        // one cached copy of this exact doc/user URL.
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
