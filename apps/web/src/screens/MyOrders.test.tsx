// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { MyOrders } from './MyOrders.js';

function setup(overrides: Parameters<typeof fakeSeekerApi>[0] = {}) {
  const api = fakeSeekerApi(overrides);
  const onOpen = vi.fn();
  const onBack = vi.fn();
  const utils = renderApp(<MyOrders api={api} onOpen={onOpen} onBack={onBack} />);
  return { api, onOpen, onBack, ...utils };
}

describe('Mere orders', () => {
  it('says so when there is nothing yet', async () => {
    setup();
    expect(await screen.findByText('Abhi koi order nahi.')).toBeTruthy();
  });

  it('lists each order with shop, items, total including the fee, and its state; active first', async () => {
    setup({
      myOrders: vi.fn(async () => [
        seekerOrder({ id: 'o-active', shopName: 'Mishra Kirana', state: 'ACCEPTED' }),
        seekerOrder({
          id: 'o-done',
          shopName: 'Gupta Store',
          state: 'DELIVERED',
          lines: [{ name: 'atta', count: 1, pricePaise: 4000 }],
          itemsTotalPaise: 4000,
          feePaise: 2000,
        }),
      ]),
    });
    const rows = await screen.findAllByRole('link', { name: /Kirana|Store/ });
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText('Mishra Kirana')).toBeTruthy();
    expect(first.getByText(/2 × sugar/)).toBeTruthy();
    // ₹90 of goods and a ₹30 fee.
    expect(first.getByText(/₹120/)).toBeTruthy();
    expect(first.getByText('Dukaan ne order le liya')).toBeTruthy();
    const second = within(rows[1] as HTMLElement);
    expect(second.getByText(/₹60/)).toBeTruthy();
    expect(second.getByText('Pahuncha diya — order poora hua')).toBeTruthy();
  });

  it('sorts active orders above finished ones even if the server sent them mixed', async () => {
    setup({
      myOrders: vi.fn(async () => [
        seekerOrder({ id: 'o1', shopName: 'Old Store', state: 'DELIVERED' }),
        seekerOrder({ id: 'o2', shopName: 'New Kirana', state: 'REQUESTED' }),
      ]),
    });
    const rows = await screen.findAllByRole('link', { name: /Kirana|Store/ });
    expect(rows[0]?.textContent).toMatch(/New Kirana/);
  });

  it('does not invent a total when no price is known', async () => {
    setup({
      myOrders: vi.fn(async () => [
        seekerOrder({ itemsTotalPaise: null, feePaise: 3000, unknownPriceCount: 1 }),
      ]),
    });
    const row = await screen.findByRole('link', { name: /Mishra Kirana/ });
    expect(row.textContent).not.toMatch(/₹0/);
    expect(row.textContent).toMatch(/Daam dukaan se poochein/);
  });

  it('opens an order with its own address', async () => {
    const { user } = setup({ myOrders: vi.fn(async () => [seekerOrder({ id: 'o-9' })]) });
    const row = await screen.findByRole('link', { name: /Mishra Kirana/ });
    expect(row.getAttribute('href')).toBe('/app/order/o-9');
    await user.click(row);
  });

  it('calls onOpen with the id when a row is tapped (no full page load)', async () => {
    const { user, onOpen } = setup({ myOrders: vi.fn(async () => [seekerOrder({ id: 'o-9' })]) });
    await user.click(await screen.findByRole('link', { name: /Mishra Kirana/ }));
    expect(onOpen).toHaveBeenCalledWith('o-9');
  });

  it('shows the kept address and lets the customer delete it', async () => {
    const savedAddress = vi
      .fn()
      .mockResolvedValueOnce({ addressText: 'Flat 4B, Sapna Apartments', customerName: 'Asha' })
      .mockResolvedValue({ addressText: null, customerName: null });
    const { user, api } = setup({ savedAddress });
    expect(await screen.findByText('Flat 4B, Sapna Apartments')).toBeTruthy();
    expect(screen.getByText('Yaad rakha hua pata')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pata hatayein' }));
    expect(api.forgetAddress).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.queryByText('Flat 4B, Sapna Apartments')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Pata hatayein' })).toBeNull();
  });

  it('shows no address block when none was kept', async () => {
    setup();
    await screen.findByText('Abhi koi order nahi.');
    expect(screen.queryByText('Yaad rakha hua pata')).toBeNull();
  });

  it('says so when the orders cannot be fetched', async () => {
    setup({
      myOrders: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/nahi/);
  });
});

describe('Mere orders: names follow the language (PR H)', () => {
  it('shows the customer’s own word on a Hindi screen, not the English catalog name', async () => {
    setup({
      myOrders: vi.fn(async () => [
        seekerOrder({
          lines: [
            { name: 'cinnamon', nameHi: 'दालचीनी', text: 'dalchini', count: 1, pricePaise: 3000 },
          ],
        }),
      ]),
    });
    expect(await screen.findByText(/1 × dalchini/)).toBeTruthy();
    expect(screen.queryByText(/cinnamon/)).toBeNull();
  });
});
