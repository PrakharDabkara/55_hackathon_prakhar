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
function load(openClients: FakeClient[] = []) {
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
  vm.runInNewContext(source, { self, URL, JSON, Promise, console });

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
      ['activate', 'install', 'notificationclick', 'push'].sort(),
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
});
