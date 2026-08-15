// YP Hymnbook offline service worker.
// Cache-first: the app loads instantly from the phone's cache (works with no
// signal), and quietly fetches a fresh copy in the background when online so
// updates appear on the next launch.

const CACHE = 'yp-hymnbook-v1';
const ASSETS = ['./', './index.html', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // The editor requests index.html with a ?fresh= marker: network-first so it
  // always edits the latest deployed version, cache fallback when offline.
  if (url.searchParams.has('fresh')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(e.request).then((resp) => {
        if (resp && resp.ok && new URL(e.request.url).origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});
