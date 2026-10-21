// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SeekerOrder } from '../lib/orders.js';
import { fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { OrderPage } from './OrderPage.js';

const pickup = (overrides: Partial<SeekerOrder> = {}) =>
  seekerOrder({
    id: 'o1',
    state: 'ACCEPTED',
    fulfilment: 'pickup',
    listId: 'list-1',
    requestId: null,
    addressText: null,
    feePaise: null,
    feeMinutes: null,
    itemsTotalPaise: 9300,
    lines: [
      { name: 'sugar', count: 1, pricePaise: 4800 },
      { name: 'turmeric powder', count: 1, pricePaise: 4500 },
      { name: 'rice', count: 1, pricePaise: 0 },
    ],
    packedCount: 2,
    shopLocation: { lat: 22.7236, lng: 75.8577 },
    ...overrides,
  });

function show(order: SeekerOrder) {
  const api = fakeSeekerApi({ getOrder: vi.fn(async () => order) });
  const utils = renderApp(<OrderPage api={api} orderId={order.id} onBack={vi.fn()} />, 'en');
  return { api, ...utils };
}

describe('a pickup order (ADR-0055)', () => {
  it('says how many lines are packed and shows no address', async () => {
    show(pickup());
    expect(await screen.findByText('Being packed · 2 of 3')).toBeTruthy();
    expect(screen.queryByText('Delivery address')).toBeNull();
    expect(screen.getByText('You pick it up at the shop and pay cash there.')).toBeTruthy();
  });

  it('follows Placed, Accepted, Ready, Collected', async () => {
    show(pickup({ state: 'ACCEPTED' }));
    const steps = within(await screen.findByRole('list', { name: 'Progress' }));
    expect(
      steps
        .getAllByRole('listitem')
        .map((li) => li.textContent?.replace(/\d+:\d+ [ap]m$/, '').trim()),
    ).toEqual(['Order placed', 'Shop accepted', 'Ready for pickup', 'Collected']);
  });

  it('when READY shows the shop location with directions and a Got it button', async () => {
    const { api, user } = show(pickup({ state: 'READY', receiveBy: '2026-10-21T14:00:00.000Z' }));
    expect(
      await screen.findByText('Ready for pickup', { selector: '.cu-order-status__caption' }),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: /Directions/ });
    expect(link.getAttribute('href')).toContain('destination=22.7236,75.8577');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(api.collectOrder).toHaveBeenCalledExactlyOnceWith('o1'));
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('shows Collected as done', async () => {
    show(pickup({ state: 'COLLECTED' }));
    expect(
      await screen.findByText('Collected', { selector: '.cu-order-status__caption' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
  });

  it('keeps a delivery order as it was, with its address and Received', async () => {
    show(seekerOrder({ state: 'OUT_FOR_DELIVERY' }));
    expect(await screen.findByRole('button', { name: 'I received it' })).toBeTruthy();
    expect(screen.getByText('Flat 4B, Sapna Apartments, Vijay Nagar')).toBeTruthy();
  });
});
