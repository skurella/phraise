// Brief 04, task 5: service worker registration and app-shell cache
// priming. See `public/sw.js`'s own file comment for the split of
// responsibilities (this file explicitly primes the cache right after a
// successful online load; the worker's fetch handler is the offline
// fallback plus a bonus opportunistic cache).
export const SHELL_CACHE_NAME = 'phraise-shell-v1'; // must match public/sw.js's CACHE_NAME

/** Registers `/sw.js` and waits until a service worker is active and
 * controlling this page. Returns `null` (never throws) when service
 * workers are unsupported -- offline support then degrades to "relay
 * unreachable, page server up" only, which is reported as such rather than
 * failing the whole app. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    return registration;
  } catch (err) {
    console.error('[phraise] service worker registration failed', err);
    return null;
  }
}

/**
 * Explicitly caches the app shell this page actually loaded: its own
 * navigation URL (so an offline reload of the exact `?doc=&user=` address
 * gets its HTML back), `/config.json`, and every same-origin resource the
 * page fetched so far (`performance.getEntriesByType('resource')` --
 * covers hashed JS/CSS chunk names and any dynamically-imported chunk,
 * with no build-time manifest needed). Best-effort per URL: one failed
 * fetch does not abort priming the rest.
 */
export async function primeOfflineCache(): Promise<void> {
  if (!('caches' in window)) return;
  const cache = await caches.open(SHELL_CACHE_NAME);

  const urls = new Set<string>();
  urls.add(window.location.pathname + window.location.search);
  urls.add('/config.json');
  for (const entry of performance.getEntriesByType('resource')) {
    const url = (entry as PerformanceResourceTiming).name;
    if (url.startsWith(window.location.origin)) urls.add(url);
  }

  await Promise.all(
    Array.from(urls).map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response.clone());
      } catch (err) {
        console.error(`[phraise] could not prime offline cache for ${url}`, err);
      }
    }),
  );
}
