import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}
const client = (url: string, navigates = true): FakeClient => ({
  url,
  focus: vi.fn(async function (this: FakeClient) {
    return this;
  }),
  navigate: navigates
    ? vi.fn(async () => undefined)
    : vi.fn(async () => {
        throw new Error('cannot navigate');
      }),
});

/** Runs public/sw.js against a stand-in for the service worker scope and returns its handlers. */
function load(openClients: FakeClient[] = [], network: Record<string, unknown> = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const self = {
    location: { origin: 'https://askbuy.example' },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => openClients),
      openWindow,
      claim: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn),
  };
  vm.runInNewContext(source, { self, URL, JSON, Promise, console, ...network });

  const waitUntil = async (event: { _p?: Promise<unknown> }) => event._p;
  const push = async (data: unknown) => {
    const event: {
      data: unknown;
      waitUntil: (p: Promise<unknown>) => void;
      _p?: Promise<unknown>;
    } = {
      data:
        data === undefined
          ? null
          : { json: () => (typeof data === 'string' ? JSON.parse(data) : data) },
      waitUntil(p) {
        event._p = p;
      },
    };
    handlers['push']?.(event);
    await waitUntil(event);
  };
  const click = async (notificationData: unknown) => {
    const close = vi.fn();
    const event: {
      notification: { data: unknown; close: () => void };
      waitUntil: (p: Promise<unknown>) => void;
      _p?: Promise<unknown>;
    } = {
      notification: { data: notificationData, close },
      waitUntil(p) {
        event._p = p;
      },
    };
    handlers['notificationclick']?.(event);
    await waitUntil(event);
    return { close };
  };
  return { handlers, showNotification, openWindow, push, click, self };
}

describe('the service worker (public/sw.js)', () => {
  it('listens for push and for a click on a notification, and takes over at once', () => {
    const { handlers } = load();
    expect(Object.keys(handlers).sort()).toEqual(
      ['activate', 'fetch', 'install', 'notificationclick', 'push'].sort(),
    );
  });

  describe('push', () => {
    it('shows the title and body, and remembers the link', async () => {
      const { push, showNotification } = load();
      await push({
        title: 'New request: atta · under 1 km',
        body: 'Open the shop to answer',
        tag: 'shop-requests',
        renotify: true,
        url: '/app/shop',
      });
      expect(showNotification).toHaveBeenCalledOnce();
      const [title, options] = showNotification.mock.calls[0] as unknown as [
        string,
        { body: string; tag: string; renotify: boolean; data: { url: string } },
      ];
      expect(title).toBe('New request: atta · under 1 km');
      expect(options.body).toBe('Open the shop to answer');
      expect(options.data.url).toBe('/app/shop');
      // The tag names the request or order, so a later push replaces the earlier one.
      expect(options.tag).toBe('shop-requests');
      expect(options.renotify).toBe(true);
    });

    it('replaces a notification silently when the push says renotify is false', async () => {
      const { push, showNotification } = load();
      await push({
        title: '2 shops have atta',
        body: 'b',
        tag: 'req:1',
        renotify: false,
        url: '/app/request/1',
      });
      const options = (
        showNotification.mock.calls[0] as unknown as [string, { renotify: boolean }]
      )[1];
      expect(options.renotify).toBe(false);
    });

    it('falls back to the link as the tag for an older payload', async () => {
      const { push, showNotification } = load();
      await push({ title: 'Naya sawaal: atta', item: 'atta', url: '/app/shop' });
      const options = (
        showNotification.mock.calls[0] as unknown as [string, { body: string; tag: string }]
      )[1];
      expect(options.tag).toBe('/app/shop');
      expect(options.body).toBe('atta');
    });

    it('still shows something when the payload cannot be read (a browser must show a notification)', async () => {
      const { push, showNotification } = load();
      await push('this is not json');
      await push(undefined);
      expect(showNotification).toHaveBeenCalledTimes(2);
      const [title, options] = showNotification.mock.calls[0] as unknown as [
        string,
        { data: { url: string } },
      ];
      expect(title).toBe('AskBuy');
      expect(options.data.url).toBe('/app/');
    });

    it('does not trust a link that leaves the app', async () => {
      const { push, showNotification } = load();
      for (const url of [
        'https://evil.example/x',
        '//evil.example',
        'javascript:alert(1)',
        '/other',
      ]) {
        await push({ title: 't', item: 'i', url });
      }
      for (const call of showNotification.mock.calls) {
        expect((call as unknown as [string, { data: { url: string } }])[1].data.url).toBe('/app/');
      }
    });
  });

  describe('clicking a notification', () => {
    it('closes it', async () => {
      const { click } = load();
      expect((await click({ url: '/app/shop' })).close).toHaveBeenCalledOnce();
    });

    it('focuses the tab that already shows that page', async () => {
      const same = client('https://askbuy.example/app/order/abc');
      const other = client('https://askbuy.example/app/');
      const { click, openWindow } = load([other, same]);
      await click({ url: '/app/order/abc' });
      expect(same.focus).toHaveBeenCalledOnce();
      expect(same.navigate).not.toHaveBeenCalled();
      expect(other.focus).not.toHaveBeenCalled();
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('otherwise takes an open app tab to the link', async () => {
      const tab = client('https://askbuy.example/app/');
      const { click, openWindow } = load([tab]);
      await click({ url: '/app/request/r1' });
      expect(tab.focus).toHaveBeenCalledOnce();
      expect(tab.navigate).toHaveBeenCalledWith('https://askbuy.example/app/request/r1');
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('opens the link in a new window when no app tab is open', async () => {
      const elsewhere = client('https://askbuy.example/health');
      const { click, openWindow } = load([elsewhere]);
      await click({ url: '/app/errand/e1' });
      expect(elsewhere.focus).not.toHaveBeenCalled();
      expect(openWindow).toHaveBeenCalledWith('https://askbuy.example/app/errand/e1');
    });

    it('opens a new window when the open tab refuses to navigate', async () => {
      const tab = client('https://askbuy.example/app/', false);
      const { click, openWindow } = load([tab]);
      await click({ url: '/app/order/o1' });
      expect(openWindow).toHaveBeenCalledWith('https://askbuy.example/app/order/o1');
    });

    it('falls back to the app home for a missing or foreign link', async () => {
      for (const data of [undefined, {}, { url: 'https://evil.example/' }]) {
        const { click, openWindow } = load([]);
        await click(data);
        expect(openWindow).toHaveBeenCalledWith('https://askbuy.example/app/');
      }
    });
  });
  describe('keeping the app shell for offline (ADR-0057)', () => {
    const ORIGIN = 'https://askbuy.example';
    const PAGE = `<!doctype html><link rel="icon" href="/app/favicon.svg"><script src="/app/theme-init.js"></script>
      <script type="module" src="/app/assets/main-abc.js"></script>
      <link rel="stylesheet" href="/app/assets/main-abc.css"><link rel="manifest" href="/app/manifest.json">`;
    const CSS = `@font-face{src:url(./mukta-latin-400-normal-x.woff2) format("woff2"),url(./mukta-latin-400-normal-x.woff) format("woff")}
      @font-face{src:url(./mukta-devanagari-400-normal-y.woff2) format("woff2")}`;

    /** A Cache API in memory, and a network that serves `files` (or nothing when `online` is false). */
    function world(files: Record<string, string>) {
      const stores = new Map<string, Map<string, string>>();
      const pathOf = (input: unknown) =>
        new URL(typeof input === 'string' ? input : (input as { url: string }).url, ORIGIN)
          .pathname;
      const open = async (name: string) => {
        const store = stores.get(name) ?? new Map<string, string>();
        stores.set(name, store);
        return {
          put: async (key: unknown, response: { body: string }) =>
            void store.set(pathOf(key), response.body),
          match: async (key: unknown) =>
            store.has(pathOf(key)) ? { ok: true, body: store.get(pathOf(key)) } : undefined,
          add: async (key: unknown) => {
            const response = await net.fetch(key);
            if (!response.ok) throw new Error('not ok');
            store.set(pathOf(key), response.body);
          },
        };
      };
      const net = {
        online: true,
        requested: [] as string[],
        async fetch(input: unknown) {
          const path = pathOf(input);
          net.requested.push(path);
          if (!net.online) throw new TypeError('offline');
          const body = files[path];
          const response = {
            ok: body !== undefined,
            body: body ?? '',
            text: async () => body ?? '',
          };
          return { ...response, clone: () => response };
        },
      };
      const caches = {
        open,
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
      };
      return { stores, net, caches };
    }
    const files = {
      '/app/': PAGE,
      '/app/theme-init.js': 'init',
      '/app/favicon.svg': '<svg/>',
      '/app/manifest.json': '{}',
      '/app/assets/main-abc.js': 'js',
      '/app/assets/main-abc.css': CSS,
      '/app/assets/mukta-latin-400-normal-x.woff2': 'font',
      '/app/assets/mukta-latin-400-normal-x.woff': 'font-old',
      '/app/assets/mukta-devanagari-400-normal-y.woff2': 'hindi-font',
    };
    const run = async (
      event: Record<string, unknown>,
      type: string,
      h: ReturnType<typeof load>,
    ) => {
      let pending: Promise<unknown> = Promise.resolve();
      h.handlers[type]?.({
        ...event,
        waitUntil: (p: Promise<unknown>) => void (pending = p),
        respondWith: (p: Promise<unknown>) => void (pending = p),
      });
      return pending;
    };
    const setup = (kept = files) => {
      const w = world(kept);
      const h = load([], { caches: w.caches, fetch: (i: unknown) => w.net.fetch(i) });
      return { w, h };
    };
    const shell = (w: ReturnType<typeof world>) => w.stores.get('askbuy-shell-1');

    it('stores the page, its script and styles, the icons and the Latin fonts at install', async () => {
      const { w, h } = setup();
      await run({}, 'install', h);
      expect([...(shell(w)?.keys() ?? [])].sort()).toEqual([
        '/app/',
        '/app/assets/main-abc.css',
        '/app/assets/main-abc.js',
        '/app/assets/mukta-latin-400-normal-x.woff2',
        '/app/favicon.svg',
        '/app/manifest.json',
        '/app/theme-init.js',
      ]);
    });

    it('still installs when the network is down (push matters more)', async () => {
      const { w, h } = setup();
      w.net.online = false;
      await expect(run({}, 'install', h)).resolves.toBeUndefined();
      expect(h.self.skipWaiting).toHaveBeenCalled();
    });

    it('opens any address of the app from the kept page when offline', async () => {
      const { w, h } = setup();
      await run({}, 'install', h);
      w.net.online = false;
      for (const path of ['/app/', '/app/shop', '/app/request/r1']) {
        const response = (await run(
          { request: { method: 'GET', mode: 'navigate', url: ORIGIN + path } },
          'fetch',
          h,
        )) as { body: string };
        expect(response.body, path).toBe(PAGE);
      }
    });

    it('serves a kept hashed file without asking the network', async () => {
      const { w, h } = setup();
      await run({}, 'install', h);
      w.net.requested.length = 0;
      const response = (await run(
        { request: { method: 'GET', mode: 'cors', url: `${ORIGIN}/app/assets/main-abc.js` } },
        'fetch',
        h,
      )) as { body: string };
      expect(response.body).toBe('js');
      expect(w.net.requested).toEqual([]);
    });

    it('keeps a file the first time a page uses it (the Devanagari fonts)', async () => {
      const { w, h } = setup();
      await run({}, 'install', h);
      await run(
        {
          request: {
            method: 'GET',
            mode: 'cors',
            url: `${ORIGIN}/app/assets/mukta-devanagari-400-normal-y.woff2`,
          },
        },
        'fetch',
        h,
      );
      expect(shell(w)?.get('/app/assets/mukta-devanagari-400-normal-y.woff2')).toBe('hindi-font');
    });

    it('leaves the API, other sites, writes and the worker file alone', async () => {
      const { h } = setup();
      let answered = false;
      const ignore = (request: Record<string, unknown>) =>
        h.handlers['fetch']?.({ request, respondWith: () => void (answered = true) });
      ignore({ method: 'GET', mode: 'cors', url: `${ORIGIN}/requests` });
      ignore({ method: 'GET', mode: 'cors', url: 'https://tile.openstreetmap.org/1/2/3.png' });
      ignore({ method: 'POST', mode: 'cors', url: `${ORIGIN}/app/x` });
      ignore({ method: 'GET', mode: 'cors', url: `${ORIGIN}/app/sw.js` });
      expect(answered).toBe(false);
    });

    it('deletes the caches of older versions when it takes over', async () => {
      const { w, h } = setup();
      await w.caches.open('askbuy-shell-0');
      await run({}, 'activate', h);
      expect([...w.stores.keys()]).not.toContain('askbuy-shell-0');
    });
  });
});
