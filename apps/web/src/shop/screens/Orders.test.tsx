// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import { fakeApi, shop, shopOrder } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import type { ShopData } from '../lib/useShopData.js';
import { ToastProvider } from '../../ui/Toast.js';
import { Orders } from './Orders.js';

// 19 Oct 2026, 7 pm local: "today" is the 19th.
const NOW = new Date('2026-10-19T19:00:00').getTime();
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
    setPacked: vi.fn(async () => undefined),
    markAnswered: vi.fn(),
    setOpen: vi.fn(async () => undefined),
    ...over,
  };
}

function setup(over: Partial<ShopData> = {}, api = fakeApi()) {
  const d = data(over);
  const view = renderApp(
    <ToastProvider>
      <Orders api={api} data={d} now={NOW} />
    </ToastProvider>,
    'en',
  );
  return { ...view, api, d };
}

const accepted = shopOrder({
  id: 'acc',
  state: 'ACCEPTED',
  createdAt: '2026-10-19T18:12:00',
  updatedAt: '2026-10-19T18:12:00',
  contactName: 'Ravi',
  addressText: 'Flat 4B, Sapna Apartments',
  mapUrl: 'https://maps.example/x',
  note: 'Ring twice',
  itemsTotalPaise: 9000,
  feePaise: 2000,
  lines: [{ name: 'sugar', count: 2, pricePaise: 4500 }],
});
const out = shopOrder({
  id: 'out',
  state: 'OUT_FOR_DELIVERY',
  createdAt: '2026-10-19T17:00:00',
  updatedAt: '2026-10-19T17:30:00',
});
const done = (state: string, id: string, extra = {}) =>
  shopOrder({
    id,
    state: state as 'DELIVERED',
    final: true,
    updatedAt: '2026-10-19T15:00:00',
    ...extra,
  });

describe('Orders', () => {
  it('titles the page and splits active from done today', () => {
    setup({
      orders: [
        accepted,
        out,
        done('DELIVERED', 'd1'),
        done('DELIVERED', 'yesterday', { updatedAt: '2026-10-18T15:00:00' }),
      ],
    });
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Active · 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Done today · 1' })).toBeTruthy();
  });

  it('shows a card with the delivery chip, the status line, items and the cash total', () => {
    setup({ orders: [accepted] });
    const card = screen.getByRole('article');
    expect(within(card).getByText('Delivery')).toBeTruthy();
    expect(within(card).getByText(/Customer chose you · 6:12\s?pm/i)).toBeTruthy();
    expect(within(card).getByText('2 × Sugar')).toBeTruthy();
    expect(within(card).getByText('₹110 incl. ₹20 delivery · collect cash')).toBeTruthy();
    expect(within(card).getByText('“Ring twice”')).toBeTruthy();
  });

  it('shows the address, the name and a map link once accepted', () => {
    setup({ orders: [accepted] });
    expect(screen.getByText('Flat 4B, Sapna Apartments')).toBeTruthy();
    expect(screen.getByText('For: Ravi')).toBeTruthy();
    const map = screen.getByRole('link', { name: 'Open map' });
    expect(map.getAttribute('href')).toBe('https://maps.example/x');
    expect(map.getAttribute('target')).toBe('_blank');
  });

  it('never shows a name or an address for an order that is only requested', () => {
    setup({ orders: [shopOrder({ id: 'r', state: 'REQUESTED', contactName: 'Ravi' })] });
    expect(screen.queryByText(/Ravi/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open map' })).toBeNull();
  });

  it('sends an accepted order out for delivery', async () => {
    const { user, api, d } = setup({ orders: [accepted] });
    const button = screen.getByRole('button', { name: 'Out for delivery' });
    expect(button.className).toContain('sh-btn--primary');
    await user.click(button);
    await waitFor(() => expect(api.orderAction).toHaveBeenCalledWith('acc', 'out'));
    expect(d.refresh).toHaveBeenCalled();
  });

  it('keeps one primary button on the screen when several orders are waiting', () => {
    setup({ orders: [accepted, shopOrder({ ...accepted, id: 'acc2' })] });
    const buttons = screen.getAllByRole('button', { name: 'Out for delivery' });
    expect(buttons.filter((b) => b.className.includes('sh-btn--primary'))).toHaveLength(1);
  });

  it('only waits for the customer once an order is out', () => {
    setup({ orders: [out] });
    expect(screen.getByText('Waiting for the customer to confirm')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Out for delivery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('cancels with a reason, and the reason is needed first', async () => {
    const { user, api } = setup({ orders: [accepted] });
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const sheet = screen.getByRole('dialog', { name: 'Cancel this order' });
    const confirm = within(sheet).getByRole('button', {
      name: 'Cancel order',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(within(sheet).getByRole('button', { name: "Can't deliver now" }));
    await user.click(confirm);
    await waitFor(() =>
      expect(api.cancelOrder).toHaveBeenCalledWith('acc', { reason: 'cannot_deliver_now' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for a note under Other, at most 140 characters', async () => {
    const { user, api } = setup({ orders: [accepted] });
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByLabelText('Add a note · optional')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Other' }));
    const note = within(sheet).getByLabelText('Add a note · optional') as HTMLInputElement;
    expect(note.maxLength).toBe(140);
    await user.type(note, 'Shop is closing');
    await user.click(within(sheet).getByRole('button', { name: 'Cancel order' }));
    await waitFor(() =>
      expect(api.cancelOrder).toHaveBeenCalledWith('acc', {
        reason: 'other',
        text: 'Shop is closing',
      }),
    );
  });

  it('lets the shop keep the order', async () => {
    const { user, api } = setup({ orders: [accepted] });
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it('shows the finished orders as plain status text', async () => {
    const { user } = setup({
      orders: [
        done('DELIVERED', 'a'),
        done('NOT_CONFIRMED', 'b'),
        done('CANCELLED', 'c', { cancelReason: 'out_of_stock' }),
        done('DECLINED', 'd'),
        done('EXPIRED', 'e'),
      ],
    });
    await user.click(screen.getByRole('button', { name: /Done today/ }));
    for (const text of [
      'Delivered',
      'Not confirmed by customer',
      'Cancelled · Out of stock',
      'Declined',
      'Expired',
    ])
      expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Out for delivery' })).toBeNull();
  });

  it('has an empty state for each tab', async () => {
    const { user } = setup({ orders: [] });
    expect(screen.getByText('No active orders')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Done today/ }));
    expect(screen.getByText('Nothing finished today yet.')).toBeTruthy();
  });

  it('shows skeletons while loading and an error with a retry when it fails', async () => {
    const first = setup({ orders: null });
    expect(screen.getByText('Loading')).toBeTruthy();
    first.unmount();
    const { user, d } = setup({ orders: null, ordersFailed: true });
    expect(screen.getByText("Couldn't load. Check your connection and try again.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(d.refresh).toHaveBeenCalled();
  });

  it('says what to do when an action cannot be sent', async () => {
    const api = fakeApi({ orderAction: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user } = setup({ orders: [accepted] }, api);
    await user.click(screen.getByRole('button', { name: 'Out for delivery' }));
    expect(
      await screen.findByText("Couldn't send. Check your connection and try again."),
    ).toBeTruthy();
  });

  it('a double tap on Out for delivery sends it once', async () => {
    const { user, api } = setup({ orders: [accepted] });
    await user.dblClick(screen.getByRole('button', { name: 'Out for delivery' }));
    await waitFor(() => expect(api.orderAction).toHaveBeenCalledTimes(1));
  });

  it('if the order moved meanwhile (409) it just refreshes, with no error shown', async () => {
    const api = fakeApi({
      orderAction: vi.fn(async () => Promise.reject(new ApiError(409, 'conflict', 'moved'))),
    });
    const { user, d } = setup({ orders: [accepted] }, api);
    await user.click(screen.getByRole('button', { name: 'Out for delivery' }));
    await waitFor(() => expect(d.refresh).toHaveBeenCalled());
    expect(screen.queryByText("Couldn't send. Check your connection and try again.")).toBeNull();
  });

  it('a request that is not accepted yet has Accept and Decline but no Cancel', async () => {
    const { user, api } = setup({ orders: [shopOrder({ id: 'r', state: 'REQUESTED' })] });
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.orderAction).toHaveBeenCalledWith('r', 'accept'));
  });
});
