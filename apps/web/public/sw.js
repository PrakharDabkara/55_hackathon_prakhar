// KahanMilega service worker (ADR-0034): shows a Web Push and opens the right screen on a tap.
// Plain JavaScript on purpose: it is served as-is from /app/sw.js, not bundled. It caches nothing.
const HOME = '/app/';

/** A path inside /app/ and nothing else; a link that leaves the app falls back to the home screen. */
function safePath(value) {
  if (typeof value !== 'string') return HOME;
  if (!value.startsWith('/app/') || value.startsWith('//')) return HOME;
  return value;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let title = 'KahanMilega';
  let body = '';
  let url = HOME;
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === 'string') title = data.title;
    if (data && typeof data.item === 'string') body = data.item;
    if (data) url = safePath(data.url);
  } catch {
    // A payload we cannot read still has to show something: a browser may not push silently.
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/app/icon-192.png',
      badge: '/app/icon-192.png',
      // One notification per screen: a second ping to the shop replaces the first instead of stacking.
      tag: url,
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const inApp = windows.filter((w) => new URL(w.url).pathname.startsWith('/app/'));
      const same = inApp.find((w) => w.url === target);
      if (same) {
        await same.focus();
        return;
      }
      const tab = inApp[0];
      if (tab) {
        try {
          await tab.focus();
          await tab.navigate(target);
          return;
        } catch {
          // A tab we may not steer: open the link in a window of its own.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
