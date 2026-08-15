// YP Hymnbook offline service worker.
// Cache-first, so the hymnbook opens instantly and works with no signal.
// After serving the saved copy it checks the live site in the background; if
// what's online differs, it tells the app so it can offer "Tap to update".
//
// The background check uses cache:'no-store' deliberately. Without it the
// browser's own HTTP cache can answer the request, so a freshly uploaded file
// stays invisible for as long as that cached copy lives.

const CACHE = 'yp-hymnbook-v4';
const ASSETS = ['./', './index.html', './editor.html', './apple-touch-icon.png'];

// A captive portal (hotel or airport wi-fi) or a sign-in gate answers ANY
// request with 200 and a page of its own. Caching that would quietly replace
// the hymnbook with someone else's login form, and the app would then open to
// it offline. So before saving anything, check the body is really ours.
const MARKERS = {
  'index.html': 'id="hymns-data"',
  'editor.html': '<title>YP Hymnbook Editor</title>',
};

async function isGenuine(request, resp) {
  const path = new URL(request.url).pathname;
  if (/\.png$/i.test(path)) {
    return (resp.headers.get('content-type') || '').startsWith('image/');
  }
  const name = path.endsWith('/') ? 'index.html' : path.split('/').pop();
  const marker = MARKERS[name];
  if (!marker) return true;
  try {
    return (await resp.clone().text()).includes(marker);
  } catch (err) {
    return false;
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(
      ASSETS.map((url) => {
        const req = new Request(url);
        // no-store here too: on a fresh install the browser's HTTP cache could
        // otherwise seed us with a page that is already out of date.
        return fetch(req, { cache: 'no-store' })
          .then(async (resp) => {
            if (!resp || !resp.ok) return null;
            if (!(await isGenuine(req, resp))) return null;
            return cache.put(req, resp);
          });
      })
    // allSettled, not all: one missing file must not stop the worker installing.
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'yp-check-update') e.waitUntil(checkForUpdate());
});

function sameOrigin(url) {
  return new URL(url).origin === self.location.origin;
}

function isPage(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return /\.html$/i.test(path) || path.endsWith('/');
}

function notifyUpdateReady() {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then((clients) => clients.forEach((c) => c.postMessage({ type: 'yp-update-ready' })));
}

// Pull the real file from the network, save it, and flag genuine changes.
async function refresh(request, cachedCopy) {
  if (!sameOrigin(request.url)) return;
  let resp;
  try {
    resp = await fetch(request, { cache: 'no-store' });
  } catch (err) {
    return; // offline: keep the saved copy
  }
  if (!resp || !resp.ok) return;
  // Never let a login page or portal splash overwrite the saved hymnbook.
  if (!(await isGenuine(request, resp))) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, resp.clone());
  if (!cachedCopy) return;
  try {
    const [oldText, newText] = await Promise.all([cachedCopy.text(), resp.text()]);
    if (oldText !== newText) await notifyUpdateReady();
  } catch (err) {}
}

async function checkForUpdate() {
  const cache = await caches.open(CACHE);
  const cached = await cache.match('./index.html', { ignoreSearch: true });
  await refresh(new Request('./index.html'), cached || null);
}

self.addEventListener('fetch', (e) => {
  const request = e.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // The editor asks for index.html with a ?fresh= marker: network-first, so it
  // always edits exactly what is live.
  if (url.searchParams.has('fresh')) {
    e.respondWith(
      fetch(request, { cache: 'no-store' })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

  // Clone the saved copy for comparison before the page consumes it.
  let compareCopy = null;
  const lookup = caches.match(request, { ignoreSearch: true }).then((cached) => {
    if (cached && isPage(request)) compareCopy = cached.clone();
    return cached;
  });

  e.respondWith(
    lookup.then((cached) => cached || fetch(request).then((resp) => {
      if (resp && resp.ok && sameOrigin(request.url)) {
        const clone = resp.clone();
        caches.open(CACHE).then((c) => c.put(request, clone));
      }
      return resp;
    }))
  );

  e.waitUntil(lookup.then(() => refresh(request, compareCopy)));
});
