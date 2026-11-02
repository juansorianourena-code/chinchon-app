const VERSION = '1.8.0';
const CACHE = 'chinchon-' + VERSION;
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'mqttws31.min.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Siempre red primero (sin caché HTTP). La caché solo se usa sin conexión.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('version.json')) return; // nunca interceptar la comprobación de versión
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => {
    if (r.ok && url.origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
