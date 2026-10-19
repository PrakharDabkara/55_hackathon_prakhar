// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { FakeEventSource, fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { OrderPage } from './OrderPage.js';

const live = { createSource: (url: string) => new FakeEventSource(url), retryMs: 1000 };

function setup(
  order = seekerOrder(),
  overrides: Parameters<typeof fakeSeekerApi>[0] = {},
  props: Partial<Parameters<typeof OrderPage>[0]> = {},
) {
  const api = fakeSeekerApi({ getOrder: vi.fn(async () => order), ...overrides });
  const onBack = vi.fn();
  const utils = renderApp(
    <OrderPage api={api} orderId={order.id} onBack={onBack} live={live} {...props} />,
  );
  return { api, onBack, ...utils };
}

beforeEach(() => FakeEventSource.reset());

describe('one order, opened by its address', () => {
  it('fetches the order by id (so it works after a reload) and shows shop, items, total and state', async () => {
    const { api } = setup(seekerOrder({ id: 'o-7', state: 'ACCEPTED' }));
    expect(await screen.findByText('Mishra Kirana')).toBeTruthy();
    expect(api.getOrder).toHaveBeenCalledWith('o-7');
    expect(screen.getByText(/2 × sugar/)).toBeTruthy();
    expect(screen.getByText(/₹120/)).toBeTruthy();
    expect(screen.getByText('Dukaan ne order le liya')).toBeTruthy();
    expect(screen.getByText(/Flat 4B/)).toBeTruthy();
    expect(screen.getByText(/Cash on delivery/)).toBeTruthy();
  });

  describe('item names follow the screen language (PR H)', () => {
    const cinnamon = seekerOrder({
      lines: [
        { name: 'cinnamon', nameHi: 'दालचीनी', text: 'dalchini', count: 1, pricePaise: 3000 },
      ],
    });

    it('a Hindi screen shows the customer’s own word, never the English catalog name', async () => {
      setup(cinnamon);
      expect(await screen.findByText(/1 × dalchini/)).toBeTruthy();
      expect(screen.queryByText(/cinnamon/)).toBeNull();
    });

    it('falls back to the Hindi name when there is no own word', async () => {
      setup(
        seekerOrder({ lines: [{ name: 'cinnamon', nameHi: 'दालचीनी', count: 1, pricePaise: 1 }] }),
      );
      expect(await screen.findByText(/1 × दालचीनी/)).toBeTruthy();
    });

    it('an English screen shows the English name', async () => {
      const api = fakeSeekerApi({ getOrder: vi.fn(async () => cinnamon) });
      renderApp(<OrderPage api={api} orderId="order-1" onBack={vi.fn()} live={live} />, 'en');
      expect(await screen.findByText(/1 × cinnamon/)).toBeTruthy();
    });

    it('an order saved before these fields existed still shows its name', async () => {
      setup(seekerOrder());
      expect(await screen.findByText(/2 × sugar/)).toBeTruthy();
    });
  });

  it('refetches on order.updated and shows the new state', async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce(seekerOrder({ state: 'OUT_FOR_DELIVERY' }))
      .mockResolvedValue(seekerOrder({ state: 'DELIVERED' }));
    setup(seekerOrder(), { getOrder });
    expect(await screen.findByText('Nikal gaye — raste mein hai')).toBeTruthy();
    act(() => FakeEventSource.last().emit('order.updated', { orderId: 'order-1' }));
    expect(await screen.findByText('Pahuncha diya — order poora hua')).toBeTruthy();
  });

  it('can be cancelled while REQUESTED and while ACCEPTED, and not later', async () => {
    for (const state of ['REQUESTED', 'ACCEPTED'] as const) {
      const { user, api, unmount } = setup(seekerOrder({ state }));
      await user.click(await screen.findByRole('button', { name: 'Order cancel karo' }));
      expect(api.cancelOrder).toHaveBeenCalledWith('order-1');
      unmount();
    }
  });

  it.each(['OUT_FOR_DELIVERY', 'DELIVERED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const)(
    'has no cancel button when %s',
    async (state) => {
      setup(seekerOrder({ state }));
      await screen.findByText('Mishra Kirana');
      expect(screen.queryByRole('button', { name: 'Order cancel karo' })).toBeNull();
    },
  );

  it('DELIVERED says "Pahuncha diya — order poora hua"', async () => {
    setup(seekerOrder({ state: 'DELIVERED' }));
    expect(await screen.findByText('Pahuncha diya — order poora hua')).toBeTruthy();
  });

  it('DECLINED and EXPIRED say the customer should pick it up', async () => {
    setup(seekerOrder({ state: 'DECLINED', pickupFallback: true }));
    expect(await screen.findByText(/Dukaan ne mana kiya/)).toBeTruthy();
    expect(screen.getByText(/khud jaakar le lein/)).toBeTruthy();
  });

  it('EXPIRED says the shop did not answer, with the same pickup advice', async () => {
    setup(seekerOrder({ state: 'EXPIRED', pickupFallback: true }));
    expect(await screen.findByText(/Dukaan ne jawab nahi diya/)).toBeTruthy();
    expect(screen.getByText(/khud jaakar le lein/)).toBeTruthy();
  });

  it('CANCELLED says it was cancelled', async () => {
    setup(seekerOrder({ state: 'CANCELLED' }));
    expect(await screen.findByText('Order cancel ho gaya.')).toBeTruthy();
  });

  it('links back to the search or the plan the order came from', async () => {
    setup(seekerOrder({ requestId: 'req-5', errandId: null }));
    const link = await screen.findByRole('link', { name: 'Dukaan dekhein' });
    expect(link.getAttribute('href')).toBe('/app/request/req-5');
  });

  it('links to the plan when it came from an errand', async () => {
    setup(seekerOrder({ requestId: null, errandId: 'er-5' }));
    expect((await screen.findByRole('link', { name: 'Dukaan dekhein' })).getAttribute('href')).toBe(
      '/app/errand/er-5',
    );
  });

  it('after 30 days the address is gone and the page says so instead of showing an empty line', async () => {
    setup(seekerOrder({ state: 'DELIVERED', addressText: null }));
    await screen.findByText('Pahuncha diya — order poora hua');
    expect(screen.queryByText(/^Pata:/)).toBeNull();
    expect(screen.getByText('Pata 30 din baad hata diya jaata hai.')).toBeTruthy();
  });

  it('says so for an order that is not found (or not yours)', async () => {
    setup(seekerOrder(), {
      getOrder: vi.fn(async () => {
        throw new ApiError(404, 'not_found', 'No such order');
      }),
    });
    expect(await screen.findByText('Ye order nahi mila.')).toBeTruthy();
  });

  it('keeps showing the order when a refetch fails', async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce(seekerOrder())
      .mockRejectedValue(new Error('offline'));
    setup(seekerOrder(), { getOrder });
    await screen.findByText('Mishra Kirana');
    act(() => FakeEventSource.last().emit('order.updated', {}));
    await waitFor(() => expect(getOrder).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Mishra Kirana')).toBeTruthy();
  });

  it('goes back', async () => {
    const { user, onBack } = setup();
    await user.click(await screen.findByRole('button', { name: 'Wapas' }));
    expect(onBack).toHaveBeenCalled();
  });
});
