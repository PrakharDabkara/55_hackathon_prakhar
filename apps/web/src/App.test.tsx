// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { ApiError } from './lib/api.js';
import type { Session } from './lib/session.js';
import { FakeEventSource, fakeApi, ping, shop, shopOrder } from './test/fakes.js';
import { renderApp } from './test/render.js';

const memorySession = (token: string | null = null): Session & { token: string | null } => {
  const s = {
    token,
    getToken: () => s.token,
    setToken: (t: string) => {
      s.token = t;
    },
    clear: () => {
      s.token = null;
    },
  };
  return s;
};

const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 10 };

beforeEach(() => {
  location.hash = '';
  FakeEventSource.reset();
});
afterEach(() => {
  location.hash = '';
});

const app = (api = fakeApi(), session = memorySession('t')) =>
  renderApp(<App api={api} session={session} live={live} />, 'en');

describe('App: getting in', () => {
  it('starts at the login screen when there is no session', () => {
    renderApp(<App api={fakeApi()} session={memorySession()} live={live} />, 'en');
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy();
  });

  it('goes straight to the deck for a shop that is set up', async () => {
    app(fakeApi({ listPings: vi.fn(async () => [ping()]) }));
    expect(await screen.findByText('wheat flour')).toBeTruthy();
    expect(screen.getByText('Sharma Kirana')).toBeTruthy();
  });

  it('sends a new shop to setup (GET /shops/me is 404)', async () => {
    app(fakeApi({ getMyShop: vi.fn(async () => null) }));
    expect(await screen.findByRole('heading', { name: 'Set up your shop' })).toBeTruthy();
  });

  it('logs in, keeps the token, then loads the shop', async () => {
    const session = memorySession();
    const { user } = renderApp(<App api={fakeApi()} session={session} live={live} />, 'en');
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(session.token).toBe('token-1'));
    expect(await screen.findByText('No requests right now')).toBeTruthy();
  });

  it('returns to login when the session is no longer valid (401)', async () => {
    const session = memorySession('stale');
    app(
      fakeApi({ getMyShop: vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'x')) }),
      session,
    );
    expect(await screen.findByRole('button', { name: 'Send code' })).toBeTruthy();
    expect(session.token).toBeNull();
  });

  it('tells a customer account that this app is for shops (403)', async () => {
    app(fakeApi({ getMyShop: vi.fn().mockRejectedValue(new ApiError(403, 'forbidden', 'x')) }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/shop number/i);
    expect(screen.getByRole('button', { name: 'Use another number' })).toBeTruthy();
  });

  it('shows an error with a retry when the shop cannot be loaded', async () => {
    const getMyShop = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(shop());
    const { user } = app(fakeApi({ getMyShop }));
    expect(
      await screen.findByText("Couldn't load. Check your connection and try again."),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No requests right now')).toBeTruthy();
  });

  it('shows skeletons while the shop loads', () => {
    app(fakeApi({ getMyShop: vi.fn(() => new Promise<never>(() => undefined)) }));
    expect(screen.getByText('Loading')).toBeTruthy();
  });
});

describe('App: the shell', () => {
  it('opens the menu with the six places, the counts and the brand, and goes to Orders', async () => {
    const api = fakeApi({
      listPings: vi.fn(async () => [ping()]),
      listOrders: vi.fn(async () => [shopOrder({ state: 'ACCEPTED', final: false, id: 'a' })]),
    });
    const { user } = app(api);
    await screen.findByText('wheat flour');
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('dialog', { name: 'Main menu' });
    expect(within(menu).getByRole('link', { name: /Requests/ }).textContent).toContain('1');
    expect(within(menu).getByText('1 active')).toBeTruthy();
    expect(within(menu).getByText('Powered by KahanMilega')).toBeTruthy();
    await user.click(within(menu).getByRole('link', { name: /Orders/ }));
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the screen the address asks for, and Back works', async () => {
    location.hash = '#/insights';
    app();
    expect(await screen.findByRole('heading', { name: 'Insights' })).toBeTruthy();
    location.hash = '#/delivery';
    expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeTruthy();
  });

  it('closes and opens the shop from the header, with a toast', async () => {
    const api = fakeApi();
    const { user } = app(api);
    await user.click(await screen.findByRole('switch', { name: 'Open' }));
    expect(api.setShopOpen).toHaveBeenCalledWith(false);
    expect(await screen.findByText("You're closed. You won't get new requests.")).toBeTruthy();
    expect(await screen.findByRole('switch', { name: 'Closed' })).toBeTruthy();
    expect(screen.getByText("You're closed", { selector: 'h1' })).toBeTruthy();
  });

  it('logs out from the menu', async () => {
    const session = memorySession('t');
    const { user } = app(fakeApi(), session);
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(session.token).toBeNull();
    expect(await screen.findByRole('button', { name: 'Send code' })).toBeTruthy();
  });

  it('says it is offline above whatever screen is open', async () => {
    const api = fakeApi({
      listPings: vi.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('offline')),
    });
    location.hash = '#/insights';
    app(api);
    await screen.findByRole('heading', { name: 'Insights' });
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText("You're offline. Reconnect to answer.")).toBeTruthy();
  });
});

describe('App: language', () => {
  it('is English by default and switches with one button, then remembers', async () => {
    const { user } = renderApp(<App api={fakeApi()} session={memorySession()} live={live} />, 'en');
    await user.click(screen.getByRole('button', { name: 'हिंदी' }));
    expect(screen.getByRole('button', { name: 'Code bhejo' })).toBeTruthy();
    expect(localStorage.getItem('km-lang')).toBe('hi');
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy();
  });
});
