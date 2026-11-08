const VERSION = '1.18.0';
const CACHE = 'chinchon-' + VERSION;
const FILES = ['./', 'index.html', 'style.css', 'cards.js', 'app.js', 'mqttws31.min.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
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

// Notificaciones del sistema para mensajes y avisos
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title || 'Chinchón', {
      body: e.data.body || '',
      icon: e.data.icon || 'icon-192.png',
      badge: 'icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'chat-msg',
      renotify: true,
      data: e.data.data || {}
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

// Aviso Web Push (llega con la app cerrada). El contenido real se entrega al abrir la app por la red en vivo.
self.addEventListener('push', e => {
  let title = '🃏 Chinchón', body = 'Tienes un mensaje, un reto o te toca jugar. Ábrela para verlo.';
  try { if (e.data) { const j = e.data.json(); if (j.title) title = j.title; if (j.body) body = j.body; } } catch (err) {}
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [200, 100, 200, 100, 300],
    tag: 'chinchon-push', renotify: true, requireInteraction: false
  }));
});
