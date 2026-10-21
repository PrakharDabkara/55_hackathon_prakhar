// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakeSeekerApi, result, seekerOrder, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { ChooseShopSheet } from './ChooseShopSheet.js';

const delivering = result({
  shopId: 'a',
  name: 'Sharma Kirana',
  pricePaise: 4500,
  distanceM: 1200,
  delivery: { feePaise: 3000, minutes: 45 },
  quantity: { amount: 2, unit: 'kg' },
});

function open(
  shop = delivering,
  extra: Parameters<typeof fakeSeekerApi>[0] = {},
  request = seekerRequest({ id: 'req-1' }),
) {
  const api = fakeSeekerApi(extra);
  const navigate = vi.fn();
  const onClose = vi.fn();
  const onPickup = vi.fn();
  const onOrdered = vi.fn();
  const utils = renderApp(
    <ChooseShopSheet
      api={api}
      request={request}
      shop={shop}
      navigate={navigate}
      onClose={onClose}
      onPickup={onPickup}
      onOrdered={onOrdered}
    />,
    'en',
  );
  return { api, navigate, onClose, onPickup, onOrdered, ...utils };
}
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('ChooseShopSheet', () => {
  it('shows the shop, the item with quantity, and the price', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Choose this shop' });
    expect(within(dialog).getByText('Sharma Kirana')).toBeTruthy();
    expect(within(dialog).getByText('1.2 km')).toBeTruthy();
    expect(within(dialog).getByText('Sugar · 2 kg')).toBeTruthy();
    expect(within(dialog).getByText('₹45')).toBeTruthy();
  });

  it('offers only pick up when the shop does not deliver', () => {
    open(result({ shopId: 'b', name: 'B' }));
    expect(screen.queryByRole('radio', { name: /Get it delivered/ })).toBeNull();
    expect(screen.getByText(/we'll show the way/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Show the way' })).toBeTruthy();
  });

  it('defaults to pick up unless the request asked for delivery', () => {
    const plain = open();
    expect(radio(/I'll pick it up/).checked).toBe(true);
    expect(screen.getByText('₹30 delivery · about 45 min · pay cash')).toBeTruthy();
    plain.unmount();
    open(delivering, {}, seekerRequest({ wantsDelivery: true }));
    expect(radio(/Get it delivered/).checked).toBe(true);
  });

  it('says what the delivery costs: free, or fee on request', () => {
    const free = open(result({ delivery: { feePaise: 0, minutes: null } }));
    expect(screen.getByText('Free delivery · pay cash')).toBeTruthy();
    free.unmount();
    open(result({ delivery: { feePaise: null, minutes: 20 } }));
    expect(screen.getByText('Delivery fee on request · about 20 min · pay cash')).toBeTruthy();
  });

  describe('pick up', () => {
    it('"Show the way" notes the pickup, opens the route in a new tab and closes', async () => {
      const { user, onPickup, onClose } = open(result({ shopId: 'a', lat: 22.73, lng: 75.87 }));
      const link = screen.getByRole('link', { name: 'Show the way' });
      link.addEventListener('click', (e) => e.preventDefault());
      expect(link.getAttribute('href')).toBe(
        'https://www.google.com/maps/dir/?api=1&destination=22.73,75.87',
      );
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toMatch(/noopener/);
      await user.click(link);
      expect(onPickup).toHaveBeenCalledWith('a');
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('delivery', () => {
    const chooseDelivery = async (user: ReturnType<typeof open>['user']) =>
      user.click(radio(/Get it delivered/));

    it('asks for an address when none is saved, and the order needs it', async () => {
      const { user, api } = open();
      await chooseDelivery(user);
      const place = screen.getByRole('button', { name: 'Place order' });
      expect((place as HTMLButtonElement).disabled).toBe(true);
      await user.type(screen.getByLabelText('Delivery address'), 'Flat 4B, Sapna Apartments');
      expect((place as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByText('Pay cash on delivery · ₹75')).toBeTruthy();
      await user.click(place);
      expect(api.placeOrder).toHaveBeenCalledWith({
        shopId: 'a',
        requestId: 'req-1',
        addressText: 'Flat 4B, Sapna Apartments',
      });
    });

    it('sends the note and "remember this address" when ticked', async () => {
      const { user, api } = open();
      await chooseDelivery(user);
      await user.type(screen.getByLabelText('Delivery address'), 'Flat 4B, Sapna Apartments');
      await user.type(screen.getByLabelText(/Note for the shop/), 'Ring twice');
      expect(screen.getByText('10/140')).toBeTruthy();
      await user.click(screen.getByRole('checkbox', { name: 'Remember this address' }));
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      expect(api.placeOrder).toHaveBeenCalledWith({
        shopId: 'a',
        requestId: 'req-1',
        addressText: 'Flat 4B, Sapna Apartments',
        note: 'Ring twice',
        saveAddress: true,
      });
    });

    it('uses the saved address, and Change reveals a field for another one', async () => {
      const savedAddress = vi.fn(async () => ({
        id: 'ad1',
        addressText: '12 Vijay Nagar, Indore',
        customerName: null,
      }));
      const { user, api } = open(delivering, { savedAddress });
      await chooseDelivery(user);
      expect(await screen.findByText('12 Vijay Nagar, Indore')).toBeTruthy();
      expect(screen.queryByLabelText('Delivery address')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      expect(api.placeOrder).toHaveBeenCalledWith({
        shopId: 'a',
        requestId: 'req-1',
        addressText: '12 Vijay Nagar, Indore',
      });
    });

    it('lets the customer type a different address instead of the saved one', async () => {
      const savedAddress = vi.fn(async () => ({
        id: 'ad1',
        addressText: '12 Vijay Nagar, Indore',
        customerName: null,
      }));
      const { user, api } = open(delivering, { savedAddress });
      await chooseDelivery(user);
      await screen.findByText('12 Vijay Nagar, Indore');
      await user.click(screen.getByRole('button', { name: 'Change' }));
      await user.type(screen.getByLabelText('Delivery address'), '99 Palasia, Indore');
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      expect(api.placeOrder).toHaveBeenCalledWith({
        shopId: 'a',
        requestId: 'req-1',
        addressText: '99 Palasia, Indore',
      });
    });

    it('sends no address when the request was made with one', async () => {
      const { user, api } = open(
        delivering,
        {},
        seekerRequest({ id: 'req-1', wantsDelivery: true }),
      );
      expect(
        (screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(screen.getByText('The address you chose when you searched')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      expect(api.placeOrder).toHaveBeenCalledWith({ shopId: 'a', requestId: 'req-1' });
    });

    it('goes to the order after it is placed, and tells the screen', async () => {
      const placeOrder = vi.fn(async () => seekerOrder({ id: 'o-42' }));
      const { user, navigate, onOrdered } = open(
        delivering,
        { placeOrder },
        seekerRequest({ id: 'req-1', wantsDelivery: true }),
      );
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/order/o-42'));
      expect(onOrdered).toHaveBeenCalled();
    });

    it('shows an error and stays open when the shop is closed or the order fails', async () => {
      const placeOrder = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, 'shop_closed', 'closed'))
        .mockRejectedValueOnce(new Error('boom'));
      const { user, navigate } = open(
        delivering,
        { placeOrder },
        seekerRequest({ id: 'req-1', wantsDelivery: true }),
      );
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/closed right now/);
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe("Couldn't place the order. Try again."),
      );
      expect(navigate).not.toHaveBeenCalled();
    });

    it('asks for an address when the one from Find is gone', async () => {
      const placeOrder = vi.fn().mockRejectedValue(new ApiError(400, 'address_required', 'x'));
      const { user } = open(
        delivering,
        { placeOrder },
        seekerRequest({ id: 'req-1', wantsDelivery: true }),
      );
      await user.click(screen.getByRole('button', { name: 'Place order' }));
      expect(await screen.findByLabelText('Delivery address')).toBeTruthy();
    });

    it('sends one order for a double tap', async () => {
      let release: (o: ReturnType<typeof seekerOrder>) => void = () => undefined;
      const placeOrder = vi.fn(
        () => new Promise<ReturnType<typeof seekerOrder>>((r) => (release = r)),
      );
      const { user } = open(
        delivering,
        { placeOrder },
        seekerRequest({ id: 'req-1', wantsDelivery: true }),
      );
      const place = screen.getByRole('button', { name: 'Place order' });
      await user.dblClick(place);
      expect(placeOrder).toHaveBeenCalledTimes(1);
      release(seekerOrder());
    });
  });
});
