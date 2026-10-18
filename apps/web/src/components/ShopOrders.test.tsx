// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { ShopOrder } from '../lib/orders.js';
import { fakeApi, shopOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { ShopOrders } from './ShopOrders.js';

function setup(orders: ShopOrder[], overrides: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(overrides);
  const onChange = vi.fn();
  const utils = renderApp(<ShopOrders api={api} orders={orders} onChange={onChange} />);
  return { api, onChange, ...utils };
}

const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar';
const accepted = (over: Partial<ShopOrder> = {}) =>
  shopOrder({
    state: 'ACCEPTED',
    addressText: ADDRESS,
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=22.72,75.86',
    ...over,
  });

describe('a new order (ADR-0031)', () => {
  it('shows what to bring, the fee, the total and "Grahak" - and no address, no map', () => {
    setup([shopOrder()]);
    const card = screen.getByRole('article', { name: /order/i });
    expect(within(card).getByText(/sugar/)).toBeTruthy();
    expect(within(card).getByText(/₹90/)).toBeTruthy();
    expect(within(card).getByText(/₹30/)).toBeTruthy();
    expect(within(card).getByText('Grahak')).toBeTruthy();
    expect(within(card).getByText(/Cash on delivery/)).toBeTruthy();
    expect(within(card).queryByText(/Sapna/)).toBeNull();
    expect(within(card).queryByRole('link', { name: 'Map par dekho' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Decline' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Nikal gaye' })).toBeNull();
  });

  it('Accept and Decline go to the server, and the screen is told to refresh', async () => {
    const { user, api, onChange } = setup([shopOrder()]);
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(api.orderAction).toHaveBeenCalledWith('order-1', 'accept');
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(api.orderAction).toHaveBeenLastCalledWith('order-1', 'decline');
  });

  it('a double tap on Accept sends it once', async () => {
    const { user, api } = setup([shopOrder()]);
    await user.dblClick(screen.getByRole('button', { name: 'Accept' }));
    expect(api.orderAction).toHaveBeenCalledTimes(1);
  });

  it('if the order has moved meanwhile (409) it just refreshes, with no error shown', async () => {
    const orderAction = vi.fn(async () => {
      throw new ApiError(409, 'invalid_transition', 'no');
    });
    const { user, onChange } = setup([shopOrder()], { orderAction });
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('after Accept', () => {
  it('shows the address, a "Map par dekho" link and the contact line - never a phone', () => {
    setup([accepted({ contactName: 'Asha' })]);
    const card = screen.getByRole('article', { name: /order/i });
    expect(within(card).getByText(ADDRESS)).toBeTruthy();
    const link = within(card).getByRole('link', { name: 'Map par dekho' });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=22.72,75.86',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(within(card).getByText('Asha')).toBeTruthy();
    expect(card.textContent).not.toMatch(/\+91|\b[6-9]\d{9}\b|tel:/);
    expect(card.innerHTML).not.toMatch(/tel:/);
  });

  it('has "Nikal gaye", which sets it out', async () => {
    const { user, api } = setup([accepted()]);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Nikal gaye' }));
    expect(api.orderAction).toHaveBeenCalledWith('order-1', 'out');
  });

  it('then "Pahuncha diya", which finishes it', async () => {
    const { user, api } = setup([accepted({ state: 'OUT_FOR_DELIVERY' })]);
    expect(screen.queryByRole('button', { name: 'Nikal gaye' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pahuncha diya' }));
    expect(api.orderAction).toHaveBeenCalledWith('order-1', 'delivered');
  });
});

describe('finished orders', () => {
  it.each([
    ['DELIVERED', /Pahuncha diya gaya|Delivery ho gayi/],
    ['DECLINED', /Aapne mana kiya/],
    ['EXPIRED', /Samay nikal gaya/],
    ['CANCELLED', /Grahak ne order cancel kiya/],
  ] as const)('%s says so and has no buttons', (state, text) => {
    setup([shopOrder({ state, final: true })]);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Sapna/)).toBeNull();
  });
});

describe('nothing to show', () => {
  it('renders nothing at all without orders', () => {
    const { container } = setup([]);
    expect(container.textContent).toBe('');
  });
});
