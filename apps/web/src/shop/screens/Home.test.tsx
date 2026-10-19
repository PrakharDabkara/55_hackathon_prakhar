// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import type { PushClient, PushStatus } from '../../lib/push.js';
import { fakeApi, ping, shop, shopOrder } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import type { ShopData } from '../lib/useShopData.js';
import { ToastProvider } from '../ui/Toast.js';
import { Home } from './Home.js';

beforeEach(() =>
  vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.parse('2026-10-16T10:05:00.000Z') }),
);
afterEach(() => vi.useRealTimers());

const pushClient = (status: PushStatus): PushClient => ({
  status: vi.fn(async () => status),
  enable: vi.fn(async () => 'on' as const),
  disable: vi.fn(async () => undefined),
  resync: vi.fn(async () => undefined),
});

function data(over: Partial<ShopData> = {}): ShopData {
  return {
    shop: shop(),
    setShop: vi.fn(),
    pings: [],
    orders: [],
    loadFailed: false,
    offline: false,
    ordersFailed: false,
    isLive: false,
    banner: null,
    dismissBanner: vi.fn(),
    refresh: vi.fn(async () => undefined),
    removePing: vi.fn(),
    markAnswered: vi.fn(),
    setOpen: vi.fn(async () => undefined),
    ...over,
  };
}

function setup(over: Partial<ShopData> = {}, api = fakeApi(), status: PushStatus = 'on') {
  const d = data(over);
  const push = pushClient(status);
  const view = renderApp(
    <ToastProvider>
      <Home api={api} data={d} now={Date.now()} pushClient={push} />
    </ToastProvider>,
    'en',
  );
  return { ...view, api, d, push };
}

const rice = ping({
  id: 'rice',
  item: { slug: 'rice', nameEn: 'rice', nameHi: 'चावल' },
  expiresAt: '2026-10-16T10:12:00.000Z',
});
const flour = ping({ id: 'flour', expiresAt: '2026-10-16T10:15:00.000Z' });
const sugarDelivery = ping({
  id: 'sugar',
  item: { slug: 'sugar', nameEn: 'sugar', nameHi: 'चीनी' },
  wantsDelivery: true,
  expiresAt: '2026-10-16T10:20:00.000Z',
});

describe('Home: states', () => {
  it('shows skeletons while the first load is on its way', () => {
    setup({ pings: null, orders: null });
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(document.querySelectorAll('.sh-skeleton').length).toBeGreaterThan(0);
  });

  it('shows an error with a retry when the first load failed', async () => {
    const { user, d } = setup({ pings: null, loadFailed: true });
    expect(screen.getByText("Couldn't load. Check your connection and try again.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(d.refresh).toHaveBeenCalled();
  });

  it('shows a designed empty state with the notification pill when they are on', async () => {
    setup();
    expect(screen.getByText('No requests right now')).toBeTruthy();
    expect(
      screen.getByText("We'll notify you when someone nearby asks for something you sell."),
    ).toBeTruthy();
    expect(await screen.findByText('Notifications are on')).toBeTruthy();
  });

  it('offers to turn notifications on, and only asks the browser after a tap', async () => {
    const { user, push } = setup({}, fakeApi(), 'off');
    expect(push.enable).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(push.enable).toHaveBeenCalledOnce();
    expect(await screen.findByText('Notifications are on')).toBeTruthy();
  });

  it('shows the closed state with one primary button that opens the shop', async () => {
    const { user, d } = setup({ shop: shop({ open: false }), pings: [flour] });
    expect(screen.getByText("You're closed")).toBeTruthy();
    expect(screen.queryByText('Wheat flour')).toBeNull();
    const button = screen.getByRole('button', { name: 'Open shop' });
    expect(button.className).toContain('sh-btn--primary');
    await user.click(button);
    expect(d.setOpen).toHaveBeenCalledWith(true);
  });
});

describe('Home: the deck', () => {
  it('orders the deck: order requests, then questions by what runs out soonest', () => {
    setup({
      pings: [flour, sugarDelivery, rice],
      orders: [shopOrder({ id: 'o1', state: 'REQUESTED' })],
    });
    expect(screen.getByText("Today's requests")).toBeTruthy();
    expect(screen.getByText('1 of 4')).toBeTruthy();
    const slips = [...document.querySelectorAll('.sh-deck__slide')].map(
      (el) => el.textContent ?? '',
    );
    expect(slips[0]).toContain('Sugar');
    expect(slips[1]).toContain('Rice');
    expect(slips[2]).toContain('Wheat flour');
    expect(slips[3]).toContain('Sugar');
  });

  it('moves with the arrow buttons, and disables them at the ends', async () => {
    const { user } = setup({ pings: [rice, flour] });
    const prev = screen.getByRole('button', { name: 'Previous request' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next request' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    await user.click(next);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(next.disabled).toBe(true);
    await user.click(prev);
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('keeps the deck and the strip in one column, the strip last so it can sit at the bottom', () => {
    setup({ pings: [flour] });
    const home = document.querySelector('.sh-home') as HTMLElement;
    expect(home).toBeTruthy();
    expect(home.lastElementChild?.className).toContain('sh-strip');
    expect(home.querySelector('.sh-deck')).toBeTruthy();
  });

  it('shows the strip: active orders and answered today, each a link', async () => {
    const api = fakeApi({
      shopDemand: vi.fn(async () => ({
        days: 1,
        today: { received: 5, answered: 3, yes: 2 },
        avgReplySeconds: 60,
        asked: [],
        nearby: [],
      })),
    });
    setup(
      {
        orders: [
          shopOrder({ id: 'a', state: 'ACCEPTED', final: false }),
          shopOrder({ id: 'b', state: 'OUT_FOR_DELIVERY', final: false }),
          shopOrder({ id: 'c', state: 'DELIVERED', final: true }),
        ],
      },
      api,
    );
    const active = screen.getByRole('link', { name: /Active orders/ });
    expect(active.getAttribute('href')).toBe('#/orders');
    expect(within(active).getByText('2')).toBeTruthy();
    const today = await screen.findByRole('link', { name: /Today/ });
    expect(today.getAttribute('href')).toBe('#/insights');
    expect(within(today).getByText('3 / 5 answered')).toBeTruthy();
    expect(api.shopDemand).toHaveBeenCalledWith(1);
  });

  it('shows a new-order banner that links to Orders and can be dismissed', async () => {
    const { user, d } = setup({
      banner: shopOrder({
        id: 'n',
        state: 'ACCEPTED',
        lines: [{ name: 'sugar', count: 1, pricePaise: 4500 }],
      }),
    });
    expect(screen.getByText('Customer chose you · Sugar')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'View order' });
    expect(link.getAttribute('href')).toBe('#/orders');
    await user.click(link);
    expect(d.dismissBanner).toHaveBeenCalled();
  });
});

describe('Home: answering', () => {
  it('opens the normal sheet for a normal question and the delivery sheet for a delivery one', async () => {
    // Flour runs out first, so it is the first slip; the delivery question is second.
    const { user } = setup({ pings: [sugarDelivery, flour] });
    await user.click(screen.getAllByRole('button', { name: 'Answer' })[0] as HTMLElement);
    expect(screen.getByRole('button', { name: 'In stock' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'Answer' })[1] as HTMLElement);
    expect(screen.getByText(/Wants delivery/)).toBeTruthy();
  });

  it('sends the answer, stamps the slip, then moves on and drops it', async () => {
    const { user, api, d } = setup({ pings: [rice, flour] });
    await user.click(screen.getAllByRole('button', { name: 'Answer' })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Not available' }));
    await waitFor(() => expect(api.answerPing).toHaveBeenCalledWith('rice', { answer: 'no' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Not available', { selector: '.sh-stamp' })).toBeTruthy();
    expect(document.querySelectorAll('.sh-deck__slide')).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(document.querySelectorAll('.sh-deck__slide')).toHaveLength(1);
    expect(d.removePing).toHaveBeenCalledWith('rice');
    expect(d.refresh).toHaveBeenCalled();
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });

  it('keeps the sheet open and says so when sending fails', async () => {
    const api = fakeApi({ answerPing: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user } = setup({ pings: [rice] }, api);
    await user.click(screen.getByRole('button', { name: 'Answer' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText("Couldn't send. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('tells the shop when the customer already has an answer, and drops the question', async () => {
    const api = fakeApi({
      answerPing: vi.fn(async () => Promise.reject(new ApiError(409, 'conflict', 'gone'))),
    });
    const { user, d } = setup({ pings: [rice] }, api);
    await user.click(screen.getByRole('button', { name: 'Answer' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('The customer already has an answer. Thanks for being quick.'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(d.removePing).toHaveBeenCalledWith('rice');
  });
});

describe('Home: order requests', () => {
  const requested = shopOrder({ id: 'o1', state: 'REQUESTED' });

  it('accepts an order and says what happens next', async () => {
    const { user, api, d } = setup({ orders: [requested] });
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.orderAction).toHaveBeenCalledWith('o1', 'accept'));
    expect(await screen.findByText('Order accepted. Open Orders to send it out.')).toBeTruthy();
    expect(d.refresh).toHaveBeenCalled();
  });

  it('declines an order', async () => {
    const { user, api } = setup({ orders: [requested] });
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.orderAction).toHaveBeenCalledWith('o1', 'decline'));
    expect(await screen.findByText('Order declined.')).toBeTruthy();
  });

  it('says what to do when the order could not be answered', async () => {
    const api = fakeApi({ orderAction: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user } = setup({ orders: [requested] }, api);
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(
      await screen.findByText("Couldn't send. Check your connection and try again."),
    ).toBeTruthy();
  });
});
