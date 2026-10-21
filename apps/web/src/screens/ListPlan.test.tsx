// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { fakeSeekerApi } from '../test/fakes.js';
import { openList } from '../test/fakesLists.js';
import { renderApp } from '../test/render.js';
import { ListPlan } from './ListPlan.js';

vi.mock('../components/PlanMap.js', () => ({
  PlanMap: ({ stops }: { stops: { n: number; label: string }[] }) => (
    <div data-testid="plan-map">{stops.map((s) => `${s.n}:${s.label}`).join('|')}</div>
  ),
}));

const HERE = { lat: 22.7196, lng: 75.8577 };

function setup(overrides: Partial<SeekerApi> = {}, list = openList()) {
  const api = fakeSeekerApi({
    savedAddress: vi.fn(async () => ({
      id: 'addr-1',
      addressText: 'Flat 4B, Vijay Nagar',
      customerName: 'Asha',
    })),
    orderList: vi.fn(async () => ({
      list: { ...list, state: 'ORDERED' as const },
      orders: [],
      pickups: [],
    })),
    ...overrides,
  });
  const onOrdered = vi.fn();
  const onBack = vi.fn();
  const utils = renderApp(
    <ListPlan
      api={api}
      list={list}
      origin={HERE}
      onBack={onBack}
      onOrdered={onOrdered}
      navigate={vi.fn()}
    />,
    'en',
  );
  return { api, onOrdered, onBack, ...utils };
}

const card = (name: string) => screen.getByRole('listitem', { name });

describe('Your plan', () => {
  it('shows the shops, the items covered and the cash total', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Your plan' })).toBeTruthy();
    const stats = screen.getByRole('group', { name: 'Plan totals' });
    expect(within(stats).getByText('3')).toBeTruthy();
    expect(within(stats).getByText('5 of 5')).toBeTruthy();
    expect(within(stats).getByText('₹218')).toBeTruthy();
    expect(screen.getByTestId('plan-map').textContent).toBe(
      '1:Mishra Kirana|2:Gupta Store|3:Jain Stationers',
    );
  });

  it('has one card per shop in route order with its lines and prices', () => {
    setup();
    const cards = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-label'));
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Mishra Kirana',
      'Gupta Store',
      'Jain Stationers',
    ]);
    const mishra = card('Mishra Kirana');
    expect(within(mishra).getByText('400 m')).toBeTruthy();
    expect(within(mishra).getByText('2 items')).toBeTruthy();
    expect(within(mishra).getByText('Sugar')).toBeTruthy();
    expect(within(mishra).getByText('₹48')).toBeTruthy();
    expect(within(mishra).getByText('Turmeric powder')).toBeTruthy();
    expect(within(card('Jain Stationers')).getByText('1 item')).toBeTruthy();
  });

  it('adds the fee to the cash total when a shop is set to Deliver', async () => {
    const { user } = setup();
    await user.click(within(card('Mishra Kirana')).getByRole('button', { name: 'Deliver · ₹20' }));
    const stats = screen.getByRole('group', { name: 'Plan totals' });
    expect(within(stats).getByText('₹238')).toBeTruthy();
    expect(
      within(card('Mishra Kirana'))
        .getByRole('button', { name: 'Deliver · ₹20' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('disables Deliver for a shop that does not deliver', () => {
    setup();
    const button = within(card('Gupta Store')).getByRole('button', {
      name: "Doesn't deliver",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      within(card('Gupta Store'))
        .getByRole('button', { name: 'Pick up' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('asks for the delivery address only when a shop is set to Deliver', async () => {
    const { user } = setup();
    expect(screen.queryByText('Deliver to')).toBeNull();
    await user.click(within(card('Mishra Kirana')).getByRole('button', { name: 'Deliver · ₹20' }));
    expect(await screen.findByText('Flat 4B, Vijay Nagar')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Change address' }));
    expect(screen.getByLabelText('Delivery address')).toBeTruthy();
    expect(screen.getByLabelText(/Note for the shop/)).toBeTruthy();
  });

  it('moves a line to another shop from a sheet and recomputes', async () => {
    const { user } = setup();
    await user.click(within(card('Gupta Store')).getByRole('button', { name: /Rice/ }));
    const sheet = screen.getByRole('dialog', { name: 'Move Rice' });
    expect(within(sheet).getByText('Mishra Kirana')).toBeTruthy();
    expect(within(sheet).getByText('₹60')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: /Mishra Kirana/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(card('Mishra Kirana')).getByText('3 items')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Plan totals' })).getByText('₹223'),
    ).toBeTruthy();
  });

  it('shows lines nobody has under "Nobody has this yet"', () => {
    const base = openList();
    setup(
      {},
      openList({
        plan: {
          ...base.plan!,
          assignments: base.plan!.assignments.filter((a) => a.position !== 3),
          missing: [3],
        },
      }),
    );
    expect(screen.getByRole('heading', { name: 'Nobody has this yet' })).toBeTruthy();
    expect(screen.getByText('Tractor spare bolt')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Plan totals' })).getByText('4 of 5'),
    ).toBeTruthy();
  });

  it('orders from every shop on the plan, cash, with a mode for each', async () => {
    const { user, api, onOrdered } = setup();
    expect(
      screen.getByText('Each shop gets its own order. Prices are fixed once you order.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Order from 3 shops · pay cash' }));
    await waitFor(() => expect(api.orderList).toHaveBeenCalledTimes(1));
    expect(api.orderList).toHaveBeenCalledWith('list-1', {
      assignments: [
        { position: 0, shopId: 'shop-m' },
        { position: 1, shopId: 'shop-m' },
        { position: 2, shopId: 'shop-j' },
        { position: 3, shopId: 'shop-g' },
        { position: 4, shopId: 'shop-g' },
      ],
      modes: { 'shop-m': 'pickup', 'shop-g': 'pickup', 'shop-j': 'pickup' },
    });
    expect(onOrdered).toHaveBeenCalled();
  });

  it('leaves the address out when the kept one is used', async () => {
    const { user, api } = setup();
    await user.click(within(card('Mishra Kirana')).getByRole('button', { name: 'Deliver · ₹20' }));
    await screen.findByText('Flat 4B, Vijay Nagar');
    await user.click(screen.getByRole('button', { name: 'Order from 3 shops · pay cash' }));
    await waitFor(() => expect(api.orderList).toHaveBeenCalled());
    const first = (api.orderList as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(first.modes['shop-m']).toBe('delivery');
    expect(first.addressText).toBeUndefined();
  });

  it('needs a typed address when none is kept, and sends it with Remember', async () => {
    const { user, api } = setup({
      savedAddress: vi.fn(async () => ({ id: null, addressText: null, customerName: null })),
    });
    await user.click(within(card('Mishra Kirana')).getByRole('button', { name: 'Deliver · ₹20' }));
    const order = screen.getByRole('button', {
      name: 'Order from 3 shops · pay cash',
    }) as HTMLButtonElement;
    await screen.findByLabelText('Delivery address');
    expect(order.disabled).toBe(true);
    await user.type(screen.getByLabelText('Delivery address'), 'Flat 9, Sapna Apartments');
    await user.click(screen.getByRole('checkbox', { name: /Remember/ }));
    expect(order.disabled).toBe(false);
    await user.click(order);
    await waitFor(() => expect(api.orderList).toHaveBeenCalled());
    const body = (api.orderList as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(body).toMatchObject({ addressText: 'Flat 9, Sapna Apartments', saveAddress: true });
  });

  it.each([
    ['shop_closed', 'A shop on your plan just closed. Move its items to another shop.'],
    ['cannot_deliver', "A shop can't deliver right now. Pick up instead, or move its items."],
    ['line_not_available', 'A shop no longer has one of your items. Move it to another shop.'],
    ['list_stopped', 'You stopped this list, so it can no longer be ordered. Start a new list.'],
  ])('says what to do about %s', async (code, message) => {
    const { user, onOrdered } = setup({
      orderList: vi.fn(async () => {
        throw new ApiError(409, code, 'x');
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Order from 3 shops · pay cash' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(onOrdered).not.toHaveBeenCalled();
    // The button is back for another try.
    expect(
      (screen.getByRole('button', { name: 'Order from 3 shops · pay cash' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('sends a double tap once', async () => {
    let release: () => void = () => undefined;
    const { user, api } = setup({
      orderList: vi.fn(
        () =>
          new Promise<never>((resolve) => {
            release = () => resolve(undefined as never);
          }),
      ),
    });
    const button = screen.getByRole('button', { name: 'Order from 3 shops · pay cash' });
    await user.dblClick(button);
    expect(api.orderList).toHaveBeenCalledTimes(1);
    release();
  });
});
