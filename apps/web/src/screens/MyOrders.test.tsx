// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { timeAfter } from '../lib/time.js';
import { errandListItem, fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { MyOrders } from './MyOrders.js';

function setup(overrides: Parameters<typeof fakeSeekerApi>[0] = {}, lang: 'en' | 'hi' = 'en') {
  const api = fakeSeekerApi(overrides);
  const navigate = vi.fn();
  const onBack = vi.fn();
  const utils = renderApp(<MyOrders api={api} navigate={navigate} onBack={onBack} />, lang);
  return { api, navigate, onBack, ...utils };
}

const waiting = {
  id: 'p1',
  item: { nameEn: 'sugar', nameHi: 'चीनी' },
  shop: { name: 'Sharma Kirana' },
};

describe('My orders', () => {
  it('has the title and a way back', async () => {
    const { user, onBack } = setup();
    expect(screen.getByRole('heading', { name: 'My orders' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('says so when there are no orders, with a way back to Find', async () => {
    const { user, navigate } = setup();
    expect(await screen.findByText('No orders yet.')).toBeTruthy();
    expect(screen.getByText('Orders you place from a request show up here.')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Find an item' }));
    expect(navigate).toHaveBeenCalledWith('/app/');
  });

  it('lists recent errands with the task, status and date, each a link to the errand', async () => {
    const myErrands = vi.fn(async () => [
      errandListItem({ id: 'e-1', task: 'school things for Riya', state: 'PLAN_READY' }),
      errandListItem({
        id: 'e-2',
        task: 'diwali sweets and diyas',
        state: 'CANCELLED',
        createdAt: '2026-10-15T10:00:00.000Z',
      }),
    ]);
    const { user, navigate } = setup({ myErrands });
    const section = (await screen.findByRole('heading', { name: 'Errands' })).closest('section');
    expect(section).toBeTruthy();
    const rows = within(section as HTMLElement).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('href')).toBe('/app/errand/e-1');
    expect(rows[0]?.textContent).toContain('school things for Riya');
    expect(rows[0]?.textContent).toContain('Plan ready');
    expect(rows[0]?.textContent).toContain('16 Oct');
    expect(rows[1]?.textContent).toContain('Cancelled');
    await user.click(rows[0] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/app/errand/e-1');
    // Errands are not orders: the "No orders yet" empty state does not hide them.
    expect(screen.queryByText('No orders yet.')).toBeNull();
  });

  it('leaves the Errands section out when there are none, or when the list cannot load', async () => {
    const first = setup({ myErrands: vi.fn(async () => []) });
    expect(await screen.findByText('No orders yet.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Errands' })).toBeNull();
    first.unmount();
    setup({
      myErrands: vi.fn(async () => Promise.reject(new Error('offline'))),
      myOrders: vi.fn(async () => [seekerOrder()]),
    });
    expect(await screen.findByRole('link', { name: /Mishra Kirana/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Errands' })).toBeNull();
  });

  it('shows skeletons while loading', () => {
    setup({ myOrders: vi.fn(() => new Promise<never>(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    const myOrders = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([seekerOrder()]);
    const { user } = setup({ myOrders });
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load this.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Mishra Kirana/ })).toBeTruthy();
  });

  it('shows an offline banner', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup();
    expect(await screen.findByText("You're offline. Reconnect to see the latest.")).toBeTruthy();
    spy.mockRestore();
  });

  describe('active and earlier', () => {
    const mixed = () =>
      vi.fn(async () => [
        seekerOrder({ id: 'o-done', shopName: 'Gupta Store', state: 'DELIVERED' }),
        seekerOrder({
          id: 'o-out',
          shopName: 'Mishra Kirana',
          state: 'OUT_FOR_DELIVERY',
          feeMinutes: 45,
          outForDeliveryAt: '2026-10-16T10:20:00.000Z',
        }),
      ]);

    it('lists active orders under "Active" and finished ones under "Earlier"', async () => {
      setup({ myOrders: mixed() });
      await screen.findByRole('link', { name: /Mishra Kirana/ });
      const active = screen.getByRole('region', { name: 'Active' });
      const earlier = screen.getByRole('region', { name: 'Earlier' });
      expect(within(active).getByText('Mishra Kirana')).toBeTruthy();
      expect(within(active).queryByText('Gupta Store')).toBeNull();
      expect(within(earlier).getByText('Gupta Store')).toBeTruthy();
    });

    it('an active row shows logo, item, shop, total with the fee, a status pill and "by" time', async () => {
      setup({ myOrders: mixed() });
      const row = within(await screen.findByRole('link', { name: /Mishra Kirana/ }));
      expect(row.getByText(/2 × Sugar/)).toBeTruthy();
      expect(row.getByText('₹120')).toBeTruthy();
      expect(row.getByText('Out for delivery')).toBeTruthy();
      expect(row.getByText(`by ${timeAfter('2026-10-16T10:20:00.000Z', 45)}`)).toBeTruthy();
    });

    it('shows no "by" time when it is not known', async () => {
      setup({ myOrders: vi.fn(async () => [seekerOrder({ state: 'REQUESTED' })]) });
      const row = within(await screen.findByRole('link', { name: /Mishra Kirana/ }));
      expect(row.getByText('Waiting for the shop')).toBeTruthy();
      expect(row.queryByText(/^by /)).toBeNull();
    });

    it('an earlier row shows plain status text', async () => {
      setup({ myOrders: mixed() });
      const row = within(await screen.findByRole('link', { name: /Gupta Store/ }));
      expect(row.getByText('Delivered')).toBeTruthy();
    });

    it.each([
      [{ state: 'NOT_CONFIRMED' }, "You didn't confirm"],
      [{ state: 'CANCELLED', cancelledBy: 'shop' }, 'Cancelled by shop'],
      [{ state: 'CANCELLED', cancelledBy: 'customer' }, 'Cancelled by you'],
      [{ state: 'DECLINED' }, 'Shop declined'],
      [{ state: 'EXPIRED' }, 'No answer from shop'],
    ] as const)('earlier status for %j reads "%s"', async (over, text) => {
      setup({ myOrders: vi.fn(async () => [seekerOrder({ ...over })]) });
      expect(await screen.findByText(text)).toBeTruthy();
    });

    it('sorts active above finished even if the server sent them mixed', async () => {
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
      expect(row.textContent).toMatch(/Ask the shop for the price/);
    });

    it('opens an order with its own address, through navigate on a plain tap', async () => {
      const { user, navigate } = setup({
        myOrders: vi.fn(async () => [seekerOrder({ id: 'o-9' })]),
      });
      const row = await screen.findByRole('link', { name: /Mishra Kirana/ });
      expect(row.getAttribute('href')).toBe('/app/order/o-9');
      await user.click(row);
      expect(navigate).toHaveBeenCalledWith('/app/order/o-9');
    });
  });

  describe('"Did you get it?" card', () => {
    it('comes first, with the three answers', async () => {
      setup({
        pendingPickups: vi.fn(async () => [waiting]),
        myOrders: vi.fn(async () => [seekerOrder()]),
      });
      const question = await screen.findByText('Did you get sugar at Sharma Kirana?');
      expect(screen.getByText('Your answer helps the next person nearby.')).toBeTruthy();
      for (const name of ['Got it', "Wasn't there", "Didn't go"])
        expect(screen.getByRole('button', { name })).toBeTruthy();
      const active = await screen.findByRole('region', { name: 'Active' });
      expect(
        question.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it.each([
      ['Got it', 'found'],
      ["Wasn't there", 'not_there'],
      ["Didn't go", 'not_gone'],
    ] as const)('"%s" sends %s, removes the card and thanks quietly', async (label, answer) => {
      const { api, user } = setup({ pendingPickups: vi.fn(async () => [waiting]) });
      await user.click(await screen.findByRole('button', { name: label }));
      expect(api.answerPickup).toHaveBeenCalledWith('p1', answer);
      await waitFor(() => expect(screen.queryByText(/Did you get sugar/)).toBeNull());
      expect((await screen.findByRole('status')).textContent).toBe(
        'Thanks! Your answer helps the next person nearby.',
      );
    });

    it('is absent when nothing is waiting or it cannot be fetched', async () => {
      setup({
        pendingPickups: vi.fn(async () => {
          throw new Error('offline');
        }),
      });
      await screen.findByText('No orders yet.');
      expect(screen.queryByText(/Did you get/)).toBeNull();
    });
  });

  describe('saved address', () => {
    it('shows the kept address and lets the customer delete it, with an inline "Deleted"', async () => {
      const savedAddress = vi
        .fn()
        .mockResolvedValueOnce({
          id: 'a',
          addressText: 'Flat 4B, Sapna Apartments',
          customerName: 'Asha',
        })
        .mockResolvedValue({ id: null, addressText: null, customerName: null });
      const { user, api } = setup({ savedAddress });
      expect(await screen.findByText('Flat 4B, Sapna Apartments')).toBeTruthy();
      expect(screen.getByText(/Saved address/)).toBeTruthy();
      expect(screen.getByText(/used for delivery/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(api.forgetAddress).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByText('Flat 4B, Sapna Apartments')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
      expect(screen.getByText('Deleted')).toBeTruthy();
    });

    it('shows no address row when none was kept', async () => {
      setup();
      await screen.findByText('No orders yet.');
      expect(screen.queryByText(/Saved address/)).toBeNull();
    });
  });

  it('has a Notifications row at the bottom when push can work', async () => {
    const push = {
      status: vi.fn(async () => 'off' as const),
      enable: vi.fn(async () => 'on' as const),
      disable: vi.fn(async () => undefined),
      resync: vi.fn(async () => undefined),
    };
    const api = fakeSeekerApi();
    renderApp(<MyOrders api={api} navigate={vi.fn()} onBack={vi.fn()} pushClient={push} />, 'en');
    expect(await screen.findByRole('switch', { name: 'Notifications' })).toBeTruthy();
  });

  it('speaks Hindi on a Hindi screen', async () => {
    setup({}, 'hi');
    expect(await screen.findByText('Abhi koi order nahi.')).toBeTruthy();
  });
});
