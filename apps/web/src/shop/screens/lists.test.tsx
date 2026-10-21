// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import { fakeApi, ping, shop, shopListParchi, shopOrder } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import type { ShopData } from '../lib/useShopData.js';
import { ToastProvider } from '../../ui/Toast.js';
import { Home } from './Home.js';
import { Orders } from './Orders.js';

const NOW = Date.parse('2026-10-16T10:05:00.000Z');
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW }));
afterEach(() => vi.useRealTimers());

function data(over: Partial<ShopData> = {}): ShopData {
  return {
    shop: shop(),
    setShop: vi.fn(),
    pings: [],
    orders: [],
    lists: [],
    closedLists: [],
    loadFailed: false,
    offline: false,
    ordersFailed: false,
    isLive: false,
    banner: null,
    dismissBanner: vi.fn(),
    refresh: vi.fn(async () => undefined),
    removePing: vi.fn(),
    removeList: vi.fn(),
    dismissClosedList: vi.fn(),
    markAnswered: vi.fn(),
    setPacked: vi.fn(async () => undefined),
    setOpen: vi.fn(async () => undefined),
    ...over,
  };
}

function home(over: Partial<ShopData> = {}, api = fakeApi(), openAt?: string) {
  const d = data(over);
  const view = renderApp(
    <ToastProvider>
      <Home api={api} data={d} now={NOW} {...(openAt && { openAt })} />
    </ToastProvider>,
    'en',
  );
  return { ...view, api, d };
}

function orders(over: Partial<ShopData> = {}, api = fakeApi()) {
  const d = data(over);
  const view = renderApp(
    <ToastProvider>
      <Orders api={api} data={d} now={NOW} />
    </ToastProvider>,
    'en',
  );
  return { ...view, api, d };
}

describe('Home: list parchis in the deck', () => {
  const soonList = shopListParchi({ id: 'lp-soon', expiresAt: '2026-10-16T10:08:00.000Z' });
  const rice = ping({
    id: 'rice',
    item: { slug: 'rice', nameEn: 'rice', nameHi: 'चावल' },
    expiresAt: '2026-10-16T10:12:00.000Z',
  });
  const lateList = shopListParchi({ id: 'lp-late', expiresAt: '2026-10-16T10:14:00.000Z' });

  it('sits in the same deck as single requests, ordered by time left', () => {
    home({ pings: [rice], lists: [lateList, soonList] });
    expect(screen.getByText('1 of 3')).toBeTruthy();
    // The list with 3 minutes left is first.
    expect(screen.getByText('3m')).toBeTruthy();
    const slides = document.querySelectorAll('.sh-deck__slide');
    expect(slides).toHaveLength(3);
    expect(slides[0]!.textContent).toContain('A list · 3');
    expect(slides[1]!.textContent).toContain('Rice');
    expect(slides[2]!.textContent).toContain('A list · 3');
  });

  it('opens the deck at the list a push pointed to', () => {
    home({ pings: [rice], lists: [lateList, soonList] }, fakeApi(), 'lp-late');
    expect(screen.getByText('3 of 3')).toBeTruthy();
  });

  it('answers on the card itself: no sheet, then the ANSWERED stamp and the deck moves on', async () => {
    const api = fakeApi();
    const { user, d } = home({ lists: [soonList], pings: [rice] }, api);
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.answerList).toHaveBeenCalledWith('lp-soon', {
      lines: [
        { lineId: 'l1', have: true, priceRupees: 45 },
        { lineId: 'l2', have: false },
        { lineId: 'l3', have: false },
      ],
    });
    expect(await screen.findByText('Answered')).toBeTruthy();
    expect(d.markAnswered).toHaveBeenCalledWith('lp-soon');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(d.removeList).toHaveBeenCalledWith('lp-soon');
  });

  it('a list that closed meanwhile (409 ping_closed) says so and leaves', async () => {
    const api = fakeApi({
      answerList: vi.fn().mockRejectedValue(new ApiError(409, 'ping_closed', 'x')),
    });
    const { user, d } = home({ lists: [soonList] }, api);
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('This list has closed')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(d.removeList).toHaveBeenCalledWith('lp-soon');
  });

  it('a list closed by the customer stays as a notice, then leaves the deck', async () => {
    const { d } = home({ lists: [], closedLists: [soonList] });
    expect(screen.getByText('This list has closed')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(d.dismissClosedList).toHaveBeenCalledWith('lp-soon');
  });

  it('counts pickup orders among the active orders', () => {
    home({
      orders: [
        shopOrder({ id: 'a', state: 'ACCEPTED', fulfilment: 'pickup' }),
        shopOrder({ id: 'b', state: 'READY' as never, fulfilment: 'pickup' }),
        shopOrder({ id: 'c', state: 'ACCEPTED' }),
        shopOrder({ id: 'd', state: 'DELIVERED', final: true }),
      ],
    });
    const tile = screen.getByRole('link', { name: /Active orders/ });
    expect(within(tile).getByText('3')).toBeTruthy();
  });

  it('an order request with several lines shows the pack list and no customer identity', () => {
    home({
      orders: [
        shopOrder({
          id: 'r',
          state: 'REQUESTED',
          lines: [
            { name: 'sugar', count: 1, pricePaise: 4500 },
            { name: 'ball pen', count: 1, pricePaise: 1200 },
          ],
        }),
      ],
    });
    expect(screen.getByText('Delivery · 2 items')).toBeTruthy();
    expect(screen.getByText('Tick as you pack')).toBeTruthy();
    expect(screen.queryByText(/Grahak/)).toBeNull();
  });
});

describe('Orders: the packing parchi', () => {
  const lines = [
    { name: 'sugar', count: 2, pricePaise: 4500, packed: true },
    { name: 'ball pen', count: 1, pricePaise: 1200, packed: false },
    { name: 'tractor bolt', count: 1, pricePaise: 3000, packed: false },
  ];
  const delivery = shopOrder({
    id: 'del',
    state: 'ACCEPTED',
    lines,
    itemsTotalPaise: 13_200,
    feePaise: 2000,
    addressText: 'Flat 4B, Vijay Nagar',
    mapUrl: 'https://maps.example/x',
    createdAt: '2026-10-16T09:12:00',
  });
  const pickup = shopOrder({
    id: 'pick',
    state: 'ACCEPTED',
    fulfilment: 'pickup',
    lines,
    itemsTotalPaise: 13_200,
    feePaise: null,
    createdAt: '2026-10-16T09:12:00',
  });

  it('a delivery list order: tag, pack list, total with fee, address and "Out for delivery"', () => {
    orders({ orders: [delivery] });
    expect(screen.getByText('Delivery · 3 items')).toBeTruthy();
    expect(screen.getByText(/Customer chose you · /)).toBeTruthy();
    expect(screen.getByText('Tick as you pack')).toBeTruthy();
    expect(screen.getByText('1 of 3 packed')).toBeTruthy();
    expect(screen.getByText('Flat 4B, Vijay Nagar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Out for delivery' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeTruthy();
    expect(screen.getByText('2 items not packed yet. You can still send it out')).toBeTruthy();
  });

  it('ticking a line calls setPacked with the order, the position and the new state', async () => {
    const { user, d } = orders({ orders: [delivery] });
    await user.click(screen.getByRole('checkbox', { name: /Ball pen/ }));
    expect(d.setPacked).toHaveBeenCalledWith('del', 1, true);
  });

  it('a tick that could not be saved says so in a short toast', async () => {
    const setPacked = vi.fn().mockRejectedValue(new Error('offline'));
    const { user } = orders({ orders: [delivery], setPacked });
    await user.click(screen.getByRole('checkbox', { name: /Ball pen/ }));
    expect(await screen.findByText("Couldn't save that tick. Try again.")).toBeTruthy();
  });

  it('no unpacked note once everything is packed', () => {
    const all = shopOrder({
      ...delivery,
      lines: lines.map((l) => ({ ...l, packed: true })),
    });
    orders({ orders: [all] });
    expect(screen.queryByText(/not packed yet/)).toBeNull();
  });

  it('a pickup order: no address, "will come to pick it up", and "Ready for pickup"', async () => {
    const { user, api } = orders({ orders: [pickup] });
    expect(screen.getByText('Pickup · 3 items')).toBeTruthy();
    expect(screen.getByText('The customer will come to pick it up')).toBeTruthy();
    expect(screen.queryByText(/Out for delivery/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open map' })).toBeNull();
    expect(screen.getByText('2 items not packed yet. You can still mark it ready')).toBeTruthy();
    expect(screen.getByText('₹132 · collect cash')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ready for pickup' }));
    expect(api.orderAction).toHaveBeenCalledWith('pick', 'ready');
    // Cancel stays while ACCEPTED, as for delivery.
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeTruthy();
  });

  it('a pickup that is READY waits for the customer: no button, no cancel', () => {
    orders({ orders: [{ ...pickup, state: 'READY' as never }] });
    expect(screen.getByText('Ready · waiting for the customer to collect')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ready for pickup' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it("a single-line order keeps today's card", () => {
    orders({ orders: [shopOrder({ id: 's', state: 'ACCEPTED', addressText: 'Flat 2' })] });
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.queryByText('Tick as you pack')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Out for delivery' })).toBeTruthy();
  });
});
