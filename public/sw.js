/* Lost Minutes service worker.
 *
 * Rules about honesty and freshness:
 *  - Published data (everything under /data/, at any depth) is network-first. A cached copy is only
 *    ever a fallback, and when one is served it is marked with X-Lost-Minutes-From-Cache so the
 *    page can say so. (Until 14 September 2026 only files directly in /data/ were: the road shapes
 *    in /data/shapes/ were served from the cache for ever once fetched.)
 *  - Cached JSON is stored byte-for-byte, so every observation keeps its original timestamps.
 *    Nothing is rewritten to look newer than it is.
 *  - The build's own files: content-hashed ones (/_next/static/) never change, so the cached copy
 *    is used; anything else (the manifest, the icons, the map's modules, the bus model) is served
 *    from the cache when there is a copy and refreshed from the network behind it, so a new release
 *    reaches a returning phone on its next visit rather than never.
 *  - The page itself is network-first; the cached copy is used only when we are unreachable.
 *
 * There is no background sync and no background location tracking. The app updates only
 * while it is open in front of you.
 */
const VERSION = 'lost-minutes-v3';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-maskable.svg'];
// The two typefaces, taken at install so a returning phone has them before the page asks and an
// offline visit is still set in them. Failures here are tolerated: a font that cannot be fetched
// must never stop the worker installing, which `addAll` would do.
const OPTIONAL = ['/fonts/inter-variable.woff2', '/fonts/space-grotesk-variable.woff2'];
const DATA = /^\/data\//;
const IMMUTABLE = /^\/_next\/static\//;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION)
    .then(cache => cache.addAll(SHELL).then(() => Promise.allSettled(OPTIONAL.map(url => cache.add(url)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromCache(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Lost-Minutes-From-Cache', '1');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

function keep(request) {
  return response => {
    if (response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
    return response;
  };
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The private preview is the server's business alone: behind a password, never stored here — its
  // offer carries the provider's key (docs/PHOTO_3D_PREVIEW.md).
  if (url.pathname === '/preview' || url.pathname.startsWith('/preview/')) return;

  if (DATA.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(keep(request)).catch(() => caches.match(request, {ignoreSearch: true})
        .then(hit => hit ? fromCache(hit) : new Response(
          JSON.stringify({error: 'offline', detail: 'No copy of this data is stored on the device.'}),
          {status: 503, headers: {'Content-Type': 'application/json'}}))));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/').then(hit => hit || Response.error())));
    return;
  }

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(keep(request))));
    return;
  }

  // The cached copy at once, if there is one, and a fresh one fetched behind it for next time.
  event.respondWith(caches.match(request).then(hit => {
    const fresh = fetch(request).then(keep(request));
    if (!hit) return fresh;
    if (event.waitUntil) event.waitUntil(fresh.catch(() => {}));
    return hit;
  }));
});
