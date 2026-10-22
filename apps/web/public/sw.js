// AskBuy service worker (ADR-0034, ADR-0057): shows a Web Push and opens the right screen on a tap,
// and keeps the app shell (the page, its script and styles, the Latin fonts) so /app/ and /app/shop
// open without a network. Plain JavaScript on purpose: it is served as-is from /app/sw.js, not
// bundled. Only GET requests under /app/ are touched; the API is never cached.
const HOME = '/app/';
// Change the name when the caching rules change: activate deletes every other cache of ours.
const CACHE = 'askbuy-shell-1';
const HASHED = '/app/assets/';

/** Files named by a page or a stylesheet: the ones starting with /app/ or relative to `base`. */
function referencedFiles(text, base, pattern) {
  const found = [];
  for (const match of text.matchAll(pattern)) {
    try {
      const url = new URL(match[1], base);
      if (url.origin === self.location.origin && url.pathname.startsWith('/app/'))
        found.push(url.pathname);
    } catch {
      // Not a link we can read: skip it.
    }
  }
  return found;
}

/**
 * Stores the page and what it needs to draw: scripts, stylesheets, the icons and the Latin fonts
 * (the Devanagari ones are kept the first time a page uses them). Read from the page itself, so
 * the hashed file names of every release are found without a list to maintain.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetch(HOME, { cache: 'reload' });
  if (!page.ok) return;
  await cache.put(HOME, page.clone());
  const html = await page.text();
  const files = new Set(
    referencedFiles(html, self.location.origin + HOME, /(?:src|href)="([^"]+)"/g),
  );
  for (const file of [...files]) {
    if (!file.endsWith('.css')) continue;
    const css = await fetch(file);
    if (!css.ok) continue;
    await cache.put(file, css.clone());
    const text = await css.text();
    for (const font of referencedFiles(
      text,
      self.location.origin + file,
      /url\(["']?([^"')]+\.woff2)["']?\)/g,
    ))
      if (font.includes('-latin-')) files.add(font);
  }
  await Promise.all(
    [...files]
      .filter((file) => !file.endsWith('.css') && file !== HOME)
      .map((file) => cache.add(file).catch(() => undefined)),
  );
}

/** A path inside /app/ and nothing else; a link that leaves the app falls back to the home screen. */
function safePath(value) {
  if (typeof value !== 'string') return HOME;
  if (!value.startsWith('/app/') || value.startsWith('//')) return HOME;
  return value;
}

self.addEventListener('install', (event) => {
  // A failed download must not stop the worker from installing: push matters more than offline.
  event.waitUntil(precache().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** A page of the app (any address under /app/) is the same shell: the network first, else the kept one. */
async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(HOME, fresh.clone());
    return fresh;
  } catch (err) {
    const kept = await cache.match(HOME);
    if (kept) return kept;
    throw err;
  }
}

/** A file of the app: the kept copy at once (hashed names never change), else the network, then kept. */
async function file(request, { fresh }) {
  const cache = await caches.open(CACHE);
  if (!fresh) {
    const kept = await cache.match(request);
    if (kept) return kept;
  }
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const kept = await cache.match(request);
    if (kept) return kept;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/app/')) return;
  // The worker itself must always come from the network (the browser checks it on its own).
  if (url.pathname === '/app/sw.js') return;
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  event.respondWith(file(request, { fresh: !url.pathname.startsWith(HASHED) }));
});

self.addEventListener('push', (event) => {
  let title = 'AskBuy';
  let body = '';
  let url = HOME;
  let tag = '';
  let renotify = true;
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === 'string') title = data.title;
    // Older pushes carried the item name as `item`.
    if (data && typeof data.body === 'string') body = data.body;
    else if (data && typeof data.item === 'string') body = data.item;
    if (data) url = safePath(data.url);
    if (data && typeof data.tag === 'string') tag = data.tag.slice(0, 80);
    if (data && data.renotify === false) renotify = false;
  } catch {
    // A payload we cannot read still has to show something: a browser may not push silently.
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/app/icon-192.png',
      badge: '/app/icon-192.png',
      // The tag names the request or order, so a later push replaces the earlier one instead of
      // stacking; renotify false makes that replacement silent (ADR-0044).
      tag: tag || url,
      renotify,
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
