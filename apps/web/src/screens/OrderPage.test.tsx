// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { timeAfter, timeOfDay } from '../lib/time.js';
import { FakeEventSource, fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { OrderPage } from './OrderPage.js';

const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };

const T = {
  placed: '2026-10-16T10:00:00.000Z',
  accepted: '2026-10-16T10:05:00.000Z',
  out: '2026-10-16T10:20:00.000Z',
  done: '2026-10-16T10:50:00.000Z',
};

function setup(
  order = seekerOrder(),
  overrides: Parameters<typeof fakeSeekerApi>[0] = {},
  props: Partial<Parameters<typeof OrderPage>[0]> = {},
) {
  const api = fakeSeekerApi({ getOrder: vi.fn(async () => order), ...overrides });
  const onBack = vi.fn();
  const navigate = vi.fn();
  const utils = renderApp(
    <OrderPage
      api={api}
      orderId={order.id}
      onBack={onBack}
      navigate={navigate}
      live={live}
      {...props}
    />,
    'en',
  );
  return { api, onBack, navigate, ...utils };
}

const steps = () => within(screen.getByRole('list', { name: 'Progress' }));

beforeEach(() => FakeEventSource.reset());

describe('the order page', () => {
  it('fetches the order by id and shows the shop, items, fee and cash total', async () => {
    const { api } = setup(seekerOrder({ id: 'o-7', state: 'ACCEPTED' }));
    expect(await screen.findByText('From Mishra Kirana')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your order' })).toBeTruthy();
    expect(api.getOrder).toHaveBeenCalledWith('o-7');
    expect(screen.getByText(/2 × Sugar/)).toBeTruthy();
    expect(screen.getByText('Delivery fee')).toBeTruthy();
    expect(screen.getByText('Pay cash ₹120')).toBeTruthy();
    expect(screen.getByText(/Flat 4B/)).toBeTruthy();
  });

  it('shows the customer note', async () => {
    setup(seekerOrder({ note: 'Ring the bell twice' }));
    expect(await screen.findByText('Ring the bell twice')).toBeTruthy();
  });

  it('says the price is unknown for lines without one, and never invents ₹0', async () => {
    setup(seekerOrder({ itemsTotalPaise: null, unknownPriceCount: 1 }));
    await screen.findByText('From Mishra Kirana');
    expect(screen.getByText('Ask the shop for the price')).toBeTruthy();
    expect(screen.queryByText(/₹0/)).toBeNull();
  });

  it('adds "+N price unknown" when only some prices are known', async () => {
    setup(seekerOrder({ unknownPriceCount: 2 }));
    expect(await screen.findByText('+2 price unknown')).toBeTruthy();
    expect(screen.getByText('Pay cash ₹120')).toBeTruthy();
  });

  it('shows the way back in the bar', async () => {
    const { user, onBack } = setup();
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  describe('states with the dark status card', () => {
    it('REQUESTED: waiting caption, placed step current, later steps without times', async () => {
      setup(seekerOrder({ state: 'REQUESTED', createdAt: T.placed }));
      await screen.findByText('From Mishra Kirana');
      expect(within(screen.getByRole('status')).getByText('Waiting for the shop')).toBeTruthy();
      const items = steps().getAllByRole('listitem');
      expect(items.map((li) => li.textContent)).toEqual([
        expect.stringContaining('Order placed'),
        expect.stringContaining('Shop accepted'),
        expect.stringContaining('Out for delivery'),
        expect.stringContaining('Received'),
      ]);
      expect(items[0]?.textContent).toContain(timeOfDay(T.placed));
      expect(items[1]?.textContent).toBe('Shop accepted');
      expect(items[0]?.getAttribute('aria-current')).toBe('step');
      expect(screen.queryByText(/Reaching by/)).toBeNull();
    });

    it('ACCEPTED: accepted caption, accepted step current with its time', async () => {
      setup(seekerOrder({ state: 'ACCEPTED', createdAt: T.placed, acceptedAt: T.accepted }));
      await screen.findByText('From Mishra Kirana');
      expect(within(screen.getByRole('status')).getByText('Shop accepted')).toBeTruthy();
      const items = steps().getAllByRole('listitem');
      expect(items[1]?.getAttribute('aria-current')).toBe('step');
      expect(items[1]?.textContent).toContain(timeOfDay(T.accepted));
      expect(items[2]?.getAttribute('aria-current')).toBeNull();
    });

    it('OUT_FOR_DELIVERY: "Reaching by" is out time plus the fee minutes, and the own-person line', async () => {
      setup(
        seekerOrder({
          state: 'OUT_FOR_DELIVERY',
          feeMinutes: 45,
          outForDeliveryAt: T.out,
          acceptedAt: T.accepted,
        }),
      );
      await screen.findByText('From Mishra Kirana');
      const card = within(screen.getByRole('status'));
      expect(card.getByText('Out for delivery')).toBeTruthy();
      expect(card.getByText(`Reaching by ${timeAfter(T.out, 45)}`)).toBeTruthy();
      expect(card.getByText("The shop's own person is bringing it.")).toBeTruthy();
      expect(steps().getAllByRole('listitem')[2]?.textContent).toContain(timeOfDay(T.out));
    });

    it('falls back to "Out for delivery since" without a fee time', async () => {
      setup(seekerOrder({ state: 'OUT_FOR_DELIVERY', feeMinutes: null, outForDeliveryAt: T.out }));
      expect(await screen.findByText(`Out for delivery since ${timeOfDay(T.out)}`)).toBeTruthy();
      expect(screen.queryByText(/Reaching by/)).toBeNull();
    });

    it('shows no time line when it is not known when it set out', async () => {
      setup(seekerOrder({ state: 'OUT_FOR_DELIVERY', outForDeliveryAt: null }));
      await screen.findByText('From Mishra Kirana');
      expect(screen.queryByText(/Reaching by|since/)).toBeNull();
    });

    it('DELIVERED: delivered caption and the received step with its time', async () => {
      setup(
        seekerOrder({
          state: 'DELIVERED',
          outForDeliveryAt: T.out,
          updatedAt: T.done,
        }),
      );
      await screen.findByText('From Mishra Kirana');
      expect(within(screen.getByRole('status')).getByText('Delivered')).toBeTruthy();
      expect(steps().getAllByRole('listitem')[3]?.textContent).toContain(timeOfDay(T.done));
      expect(screen.queryByText("The shop's own person is bringing it.")).toBeNull();
    });
  });

  describe('I received it', () => {
    it('is there only while out for delivery, and marks it received', async () => {
      const { user, api } = setup(seekerOrder({ state: 'OUT_FOR_DELIVERY' }));
      await user.click(await screen.findByRole('button', { name: 'I received it' }));
      expect(api.receiveOrder).toHaveBeenCalledWith('order-1');
    });

    it.each(['REQUESTED', 'ACCEPTED', 'DELIVERED', 'CANCELLED', 'DECLINED'] as const)(
      'is not there when %s',
      async (state) => {
        setup(seekerOrder({ state }));
        await screen.findByText('From Mishra Kirana');
        expect(screen.queryByRole('button', { name: 'I received it' })).toBeNull();
      },
    );
  });

  describe('cancelling', () => {
    it.each(['REQUESTED', 'ACCEPTED'] as const)(
      '%s: opens a sheet and cancels without a reason',
      async (state) => {
        const { user, api } = setup(seekerOrder({ state }));
        await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
        const sheet = within(screen.getByRole('dialog'));
        await user.click(sheet.getByRole('button', { name: 'Cancel order' }));
        expect(api.cancelOrder).toHaveBeenCalledWith('order-1');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      },
    );

    it('passes the optional reason, up to 140 characters', async () => {
      const { user, api } = setup(seekerOrder({ state: 'ACCEPTED' }));
      await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
      const sheet = within(screen.getByRole('dialog'));
      const field = sheet.getByLabelText('Reason for the shop (optional)');
      expect(field.getAttribute('maxlength')).toBe('140');
      await user.type(field, 'Changed my mind');
      await user.click(sheet.getByRole('button', { name: 'Cancel order' }));
      expect(api.cancelOrder).toHaveBeenCalledWith('order-1', 'Changed my mind');
    });

    it('can be dismissed without cancelling', async () => {
      const { user, api } = setup(seekerOrder({ state: 'REQUESTED' }));
      await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.click(screen.getByRole('button', { name: 'Keep order' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.cancelOrder).not.toHaveBeenCalled();
    });

    it('out for delivery shows the helper text instead', async () => {
      setup(seekerOrder({ state: 'OUT_FOR_DELIVERY' }));
      expect(
        await screen.findByText("It's out for delivery, so it can't be cancelled now."),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    });

    it.each(['DELIVERED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'NOT_CONFIRMED'] as const)(
      'has no cancel when %s',
      async (state) => {
        setup(seekerOrder({ state }));
        await screen.findByText('From Mishra Kirana');
        expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
        expect(screen.queryByText(/can't be cancelled/)).toBeNull();
      },
    );
  });

  describe('plain states', () => {
    it('NOT_CONFIRMED', async () => {
      setup(seekerOrder({ state: 'NOT_CONFIRMED' }));
      expect(await screen.findByText("You didn't confirm delivery")).toBeTruthy();
    });

    it('CANCELLED by the customer', async () => {
      setup(seekerOrder({ state: 'CANCELLED', cancelledBy: 'customer' }));
      expect(await screen.findByText('You cancelled this order')).toBeTruthy();
    });

    it.each([
      ['out_of_stock', 'Out of stock'],
      ['cannot_deliver_now', "Can't deliver right now"],
      ['other', 'Another reason'],
    ] as const)('CANCELLED by the shop shows the reason %s', async (cancelReason, text) => {
      setup(seekerOrder({ state: 'CANCELLED', cancelledBy: 'shop', cancelReason }));
      expect(await screen.findByText('The shop cancelled this order')).toBeTruthy();
      expect(screen.getByText(text)).toBeTruthy();
    });

    it("CANCELLED by the shop shows the shop's own words", async () => {
      setup(
        seekerOrder({
          state: 'CANCELLED',
          cancelledBy: 'shop',
          cancelReason: 'other',
          cancelText: 'Shutter is stuck',
        }),
      );
      expect(await screen.findByText('Shutter is stuck')).toBeTruthy();
    });

    it('DECLINED says to pick it up and links to the request', async () => {
      setup(seekerOrder({ state: 'DECLINED', requestId: 'req-5' }));
      expect(
        await screen.findByText('The shop said no. You can pick it up yourself.'),
      ).toBeTruthy();
      expect(screen.getByRole('link', { name: 'See the shops' }).getAttribute('href')).toBe(
        '/app/request/req-5',
      );
      expect(screen.queryByText(/Pay cash/)).toBeNull();
    });

    it('EXPIRED says the shop did not answer', async () => {
      setup(seekerOrder({ state: 'EXPIRED', requestId: null, errandId: 'er-5' }));
      expect(
        await screen.findByText("The shop didn't answer in time. You can pick it up yourself."),
      ).toBeTruthy();
      expect(screen.getByRole('link', { name: 'See the shops' }).getAttribute('href')).toBe(
        '/app/errand/er-5',
      );
    });

    it('the source link goes through navigate on a plain tap', async () => {
      const { user, navigate } = setup(seekerOrder({ state: 'DECLINED', requestId: 'req-5' }));
      await user.click(await screen.findByRole('link', { name: 'See the shops' }));
      expect(navigate).toHaveBeenCalledWith('/app/request/req-5');
    });
  });

  it('says the address is gone after 30 days', async () => {
    setup(seekerOrder({ state: 'DELIVERED', addressText: null }));
    expect(await screen.findByText('The address is removed after 30 days.')).toBeTruthy();
  });

  it('refetches on order.updated and shows the new state', async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce(seekerOrder({ state: 'OUT_FOR_DELIVERY' }))
      .mockResolvedValue(seekerOrder({ state: 'DELIVERED' }));
    setup(seekerOrder(), { getOrder });
    expect(await screen.findByRole('button', { name: 'I received it' })).toBeTruthy();
    act(() => FakeEventSource.last().emit('order.updated', { orderId: 'order-1' }));
    expect(await within(screen.getByRole('status')).findByText('Delivered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I received it' })).toBeNull();
  });

  it('shows a skeleton while loading', () => {
    setup(seekerOrder(), { getOrder: vi.fn(() => new Promise<never>(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('says so for an order that is not found', async () => {
    setup(seekerOrder(), {
      getOrder: vi.fn(async () => {
        throw new ApiError(404, 'not_found', 'No such order');
      }),
    });
    expect(await screen.findByText("We couldn't find this order.")).toBeTruthy();
  });

  it('shows an error with a retry that fetches again', async () => {
    const getOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(seekerOrder());
    const { user } = setup(seekerOrder(), { getOrder });
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load this.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('From Mishra Kirana')).toBeTruthy();
  });

  it('keeps showing the order when a refetch fails', async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce(seekerOrder())
      .mockRejectedValue(new Error('offline'));
    setup(seekerOrder(), { getOrder });
    await screen.findByText('From Mishra Kirana');
    act(() => FakeEventSource.last().emit('order.updated', {}));
    await waitFor(() => expect(getOrder).toHaveBeenCalledTimes(2));
    expect(screen.getByText('From Mishra Kirana')).toBeTruthy();
  });

  it('shows an offline banner when the browser is offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup();
    expect(await screen.findByText("You're offline. Reconnect to see the latest.")).toBeTruthy();
    spy.mockRestore();
  });

  describe('item names follow the language', () => {
    const cinnamon = seekerOrder({
      lines: [
        { name: 'cinnamon', nameHi: 'दालचीनी', text: 'dalchini', count: 1, pricePaise: 3000 },
      ],
    });

    it('an English screen shows the English name', async () => {
      setup(cinnamon);
      expect(await screen.findByText(/1 × Cinnamon/)).toBeTruthy();
    });

    it('a Hindi screen shows the customer’s own word', async () => {
      const api = fakeSeekerApi({ getOrder: vi.fn(async () => cinnamon) });
      renderApp(<OrderPage api={api} orderId="order-1" onBack={vi.fn()} live={live} />, 'hi');
      expect(await screen.findByText(/1 × dalchini/)).toBeTruthy();
    });
  });
});
