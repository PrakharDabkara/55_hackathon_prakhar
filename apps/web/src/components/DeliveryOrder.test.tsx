// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakeSeekerApi, seekerOrder } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { DeliveryOrder } from './DeliveryOrder.js';

const shop = { id: 's1', name: 'Mishra Kirana' };
const offer = { feePaise: 3000, minutes: 45 };
const source = { requestId: 'req-1' };

function setup(
  overrides: Parameters<typeof fakeSeekerApi>[0] = {},
  props: Partial<Parameters<typeof DeliveryOrder>[0]> = {},
) {
  const api = fakeSeekerApi(overrides);
  const onChange = vi.fn();
  const utils = renderApp(
    <DeliveryOrder
      api={api}
      shop={shop}
      source={source}
      offer={offer}
      order={undefined}
      onChange={onChange}
      {...props}
    />,
  );
  return { api, onChange, ...utils };
}

describe('placing a delivery order (ADR-0031)', () => {
  it('first shows the fee, "cash on delivery" as a fixed line, and "Order bhejo"; no address box yet', () => {
    setup();
    expect(screen.getByText(/Mishra Kirana/)).toBeTruthy();
    expect(screen.getByText(/₹30/)).toBeTruthy();
    expect(screen.getByText(/Cash on delivery/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Order bhejo' })).toBeTruthy();
    expect(screen.queryByLabelText('Ghar ka pata')).toBeNull();
  });

  it('"Order bhejo" opens the address step: typed address, an optional first name, and the pin explained', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    expect(screen.getByLabelText('Ghar ka pata')).toBeTruthy();
    expect(screen.getByLabelText('Aapka naam (zaroori nahi)')).toBeTruthy();
    expect(screen.getByText(/map pin/i)).toBeTruthy();
    expect(screen.getByText(/Cash on delivery/)).toBeTruthy();
    // No money moves in the app: there is nothing to enter a card or UPI for.
    expect(screen.queryByLabelText(/card|upi/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Pakka karo' }).hasAttribute('disabled')).toBe(true);
  });

  it('sends the typed address (and name) to the server, then tells the screen to refresh', async () => {
    const { user, api, onChange } = setup();
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    await user.type(screen.getByLabelText('Ghar ka pata'), 'Flat 4B, Sapna Apartments');
    await user.type(screen.getByLabelText('Aapka naam (zaroori nahi)'), 'Asha Verma');
    await user.click(screen.getByRole('button', { name: 'Pakka karo' }));
    expect(api.placeOrder).toHaveBeenCalledWith({
      shopId: 's1',
      requestId: 'req-1',
      addressText: 'Flat 4B, Sapna Apartments',
      customerName: 'Asha Verma',
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('from a plan it names the errand, and leaves the name out if none was typed', async () => {
    const { user, api } = setup({}, { source: { errandId: 'errand-1' } });
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    await user.type(screen.getByLabelText('Ghar ka pata'), 'Behind the temple, Vijay Nagar');
    await user.click(screen.getByRole('button', { name: 'Pakka karo' }));
    expect(api.placeOrder).toHaveBeenCalledWith({
      shopId: 's1',
      errandId: 'errand-1',
      addressText: 'Behind the temple, Vijay Nagar',
    });
  });

  it('offers the address used last time, and one tap fills the boxes', async () => {
    const savedAddress = vi.fn(async () => ({
      addressText: 'Flat 4B, Sapna Apartments',
      customerName: 'Asha',
    }));
    const { user } = setup({ savedAddress });
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    await user.click(await screen.findByRole('button', { name: /Pichhla pata: Flat 4B/ }));
    expect((screen.getByLabelText('Ghar ka pata') as HTMLTextAreaElement).value).toBe(
      'Flat 4B, Sapna Apartments',
    );
    expect((screen.getByLabelText('Aapka naam (zaroori nahi)') as HTMLInputElement).value).toBe(
      'Asha',
    );
  });

  it('offers nothing when there is no saved address', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    expect(screen.queryByRole('button', { name: /Pichhla pata/ })).toBeNull();
  });

  it('says so when the shop has closed meanwhile, and keeps what was typed', async () => {
    const placeOrder = vi.fn(async () => {
      throw new ApiError(409, 'shop_closed', 'closed');
    });
    const { user } = setup({ placeOrder });
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    await user.type(screen.getByLabelText('Ghar ka pata'), 'Flat 4B, Sapna Apartments');
    await user.click(screen.getByRole('button', { name: 'Pakka karo' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/band/);
    expect((screen.getByLabelText('Ghar ka pata') as HTMLTextAreaElement).value).toBe(
      'Flat 4B, Sapna Apartments',
    );
  });

  it('a double tap sends one order', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: 'Order bhejo' }));
    await user.type(screen.getByLabelText('Ghar ka pata'), 'Flat 4B, Sapna Apartments');
    const send = screen.getByRole('button', { name: 'Pakka karo' });
    await user.dblClick(send);
    expect(api.placeOrder).toHaveBeenCalledTimes(1);
  });
});

describe('following the order', () => {
  const status = (order = seekerOrder()) => setup({}, { order, offer });

  it('waiting for the shop: says it has up to 10 minutes, and can be cancelled', async () => {
    const { user, api, onChange } = status(seekerOrder({ state: 'REQUESTED' }));
    expect(screen.getByText(/jawab ka intezaar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Order bhejo' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Order cancel karo' }));
    expect(api.cancelOrder).toHaveBeenCalledWith('order-1');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('accepted: says so, still shows cash on delivery, can still be cancelled', () => {
    status(seekerOrder({ state: 'ACCEPTED' }));
    expect(screen.getByText('Dukaan ne order le liya')).toBeTruthy();
    expect(screen.getByText(/Cash on delivery/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Order cancel karo' })).toBeTruthy();
  });

  it('out for delivery: no cancel any more', () => {
    status(seekerOrder({ state: 'OUT_FOR_DELIVERY' }));
    expect(screen.getByText('Nikal gaye — raste mein hai')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Order cancel karo' })).toBeNull();
  });

  it('delivered', () => {
    status(seekerOrder({ state: 'DELIVERED' }));
    expect(screen.getByText(/Pahunch gaya/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Order cancel karo' })).toBeNull();
  });

  it('declined: tells the customer it is pickup now, and does not offer the same order again', () => {
    status(seekerOrder({ state: 'DECLINED', pickupFallback: true }));
    expect(screen.getByText(/Dukaan ne mana kiya/)).toBeTruthy();
    expect(screen.getByText(/khud jaakar/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Order bhejo' })).toBeNull();
  });

  it('no answer in time: says that, and that it is pickup', () => {
    status(seekerOrder({ state: 'EXPIRED', pickupFallback: true }));
    expect(screen.getByText(/jawab nahi diya/)).toBeTruthy();
    expect(screen.getByText(/khud jaakar/i)).toBeTruthy();
  });

  it('cancelled by the customer: the order can be placed again', () => {
    status(seekerOrder({ state: 'CANCELLED' }));
    expect(screen.getByText('Order cancel ho gaya.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Order bhejo' })).toBeTruthy();
  });

  it('never shows a phone number', () => {
    status(seekerOrder({ state: 'ACCEPTED' }));
    expect(document.body.textContent).not.toMatch(/\+91|\b[6-9]\d{9}\b/);
  });
});
