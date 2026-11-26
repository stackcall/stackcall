// Stackcall web app service worker: only receives notices (Bora?, pokes). No offline cache:
// the app always loads fresh from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const titulo = typeof data.titulo === 'string' ? data.titulo.slice(0, 80) : 'Stackcall';
  const texto = typeof data.texto === 'string' ? data.texto.slice(0, 160) : '';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: texto,
      icon: '/app/icone-192.png',
      badge: '/app/icone-192.png',
      tag: data.tipo === 'bora' ? `bora-${data.id ?? ''}` : 'cutucada',
      renotify: true,
      data: { url: data.tipo === 'bora' ? '/app/#bora' : '/app/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/app/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((j) => new URL(j.url).pathname.startsWith('/app/'));
      if (aberta) {
        aberta.focus();
        return aberta.navigate(url).catch(() => undefined);
      }
      return self.clients.openWindow(url);
    }),
  );
});
