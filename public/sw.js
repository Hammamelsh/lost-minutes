/* Lost Minutes service worker.
 *
 * Two rules, both about honesty:
 *  - Published data is network-first. A cached copy is only ever a fallback, and when one
 *    is served it is marked with X-Lost-Minutes-From-Cache so the page can say so.
 *  - Cached JSON is stored byte-for-byte, so every observation keeps its original
 *    timestamps. Nothing is rewritten to look newer than it is.
 *
 * There is no background sync and no background location tracking. The app updates only
 * while it is open in front of you.
 */
const VERSION = 'lost-minutes-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-maskable.svg'];
const DATA = /\/data\/[^/]+\.json$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (DATA.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request, {ignoreSearch: true})
        .then(hit => hit ? fromCache(hit) : new Response(
          JSON.stringify({error: 'offline', detail: 'No copy of this data is stored on the device.'}),
          {status: 503, headers: {'Content-Type': 'application/json'}}))));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/').then(hit => hit || Response.error())));
    return;
  }

  event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
    if (response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
