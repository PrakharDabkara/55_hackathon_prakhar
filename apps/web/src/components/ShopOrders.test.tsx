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

  it('once out there is no button at all: only the customer’s Received finishes it', () => {
    setup([accepted({ state: 'OUT_FOR_DELIVERY' })]);
    expect(screen.queryByRole('button', { name: 'Nikal gaye' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pahuncha diya' })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('shows what the customer wrote for the shop', () => {
    setup([accepted({ note: 'Gate 2, ring the bell' })]);
    expect(screen.getByText(/Gate 2, ring the bell/)).toBeTruthy();
  });

  it('can cancel with a reason: pick one, add words, confirm', async () => {
    const { user, api } = setup([accepted()]);
    await user.click(screen.getByRole('button', { name: 'Cancel karo' }));
    await user.click(screen.getByRole('button', { name: 'Maal khatam' }));
    await user.click(screen.getByRole('button', { name: 'Pakka cancel' }));
    expect(api.cancelOrder).toHaveBeenCalledWith('order-1', { reason: 'out_of_stock' });
  });

  it('"Kuch aur" sends the words typed, up to 140 characters', async () => {
    const { user, api } = setup([accepted()]);
    await user.click(screen.getByRole('button', { name: 'Cancel karo' }));
    await user.click(screen.getByRole('button', { name: 'Kuch aur' }));
    const box = screen.getByLabelText('Wajah likhiye') as HTMLInputElement;
    expect(box.maxLength).toBe(140);
    await user.type(box, 'Rider bimar hai');
    await user.click(screen.getByRole('button', { name: 'Pakka cancel' }));
    expect(api.cancelOrder).toHaveBeenCalledWith('order-1', {
      reason: 'other',
      text: 'Rider bimar hai',
    });
  });

  it('a new order (not yet accepted) has no Cancel', () => {
    setup([shopOrder()]);
    expect(screen.queryByRole('button', { name: 'Cancel karo' })).toBeNull();
  });
});

describe('finished orders', () => {
  it.each([
    ['DELIVERED', /Pahuncha diya gaya|Delivery ho gayi/],
    ['DECLINED', /Aapne mana kiya/],
    ['EXPIRED', /Samay nikal gaya/],
    ['CANCELLED', /Grahak ne order cancel kiya/],
    ['NOT_CONFIRMED', /Grahak ne confirm nahi kiya/],
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

describe('active orders on top, past orders below (PR E)', () => {
  const named = (name: string) => [{ name, count: 1, pricePaise: 1000 }];
  const past = (id: string, state: 'DELIVERED' | 'DECLINED') =>
    shopOrder({ id, state, final: true, lines: named(`past-${id}`) });

  it('puts the orders to act on first, then a "Pichhle orders" heading and the finished ones', () => {
    setup([
      past('p1', 'DELIVERED'),
      shopOrder({ id: 'a1', lines: named('active-a1') }),
      past('p2', 'DECLINED'),
      accepted({ id: 'a2', lines: named('active-a2') }),
    ]);
    expect(screen.getByRole('heading', { name: 'Chal rahe orders' })).toBeTruthy();
    const heading = screen.getByRole('heading', { name: 'Pichhle orders' });
    const cards = screen.getAllByRole('article');
    const names = cards.map((card) => /(?:active|past)-[a-z]\d/.exec(card.textContent ?? '')?.[0]);
    expect(names).toEqual(['active-a1', 'active-a2', 'past-p1', 'past-p2']);
    expect(
      heading.compareDocumentPosition(cards[1] as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(cards[2] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no "Pichhle orders" heading when nothing has finished', () => {
    setup([shopOrder()]);
    expect(screen.queryByRole('heading', { name: 'Pichhle orders' })).toBeNull();
  });

  it('a past order has no action buttons', () => {
    setup([past('p1', 'DELIVERED')]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Pahuncha diya gaya')).toBeTruthy();
  });
});
