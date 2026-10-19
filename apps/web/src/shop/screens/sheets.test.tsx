// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnswerBody } from '../../lib/api.js';
import { fakePhotos, ping, shop } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { AnswerSheet } from './AnswerSheet.js';
import { WantsDeliverySheet } from './WantsDeliverySheet.js';

const delivering = shop({ deliversDefault: true, defaultFeePaise: 2000, defaultMinutes: 30 });
const quantity = { quantity: 5, unit: 'kg' };

function renderD(over: Partial<Parameters<typeof AnswerSheet>[0]> = {}) {
  const onSubmit = vi.fn(async (_body: AnswerBody) => undefined);
  const view = renderApp(
    <AnswerSheet
      ping={ping({ quantity, lastPricePaise: 4500 })}
      shop={delivering}
      photos={fakePhotos()}
      onSubmit={onSubmit}
      onClose={vi.fn()}
      {...over}
    />,
    'en',
  );
  return { ...view, onSubmit };
}

describe('AnswerSheet (a normal question)', () => {
  it('titles the sheet with the item and quantity and starts on In stock', () => {
    renderD();
    expect(screen.getByRole('dialog', { name: 'wheat flour · 5 kg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In stock' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Not available' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('prefills the last price and says so, only when there is one', () => {
    const { unmount } = renderD();
    expect((screen.getByLabelText('Price · optional') as HTMLInputElement).value).toBe('45');
    expect(screen.getByText('Last time you said ₹45')).toBeTruthy();
    unmount();
    renderD({ ping: ping({ quantity, lastPricePaise: null }) });
    expect((screen.getByLabelText('Price · optional') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/Last time you said/)).toBeNull();
  });

  it('uses a numeric keypad for the price', () => {
    renderD();
    expect(screen.getByLabelText('Price · optional').getAttribute('inputmode')).toBe('decimal');
  });

  it('prefills the quantity from the question and sends it with the price', async () => {
    const { user, onSubmit } = renderD();
    const amount = screen.getByLabelText(
      'Quantity you can give · customer asked for 5 kg',
    ) as HTMLInputElement;
    expect(amount.value).toBe('5');
    await user.clear(amount);
    await user.type(amount, '2');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith({
      answer: 'yes',
      pricePaise: 4500,
      quantity: { amount: 2, unit: 'kg' },
      delivery: { feePaise: 2000, minutes: 30 },
    });
  });

  it('accepts a decimal quantity with a comma', async () => {
    const { user, onSubmit } = renderD({ shop: shop() });
    const amount = screen.getByLabelText('Quantity you can give · customer asked for 5 kg');
    await user.clear(amount);
    await user.type(amount, '1,5');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: { amount: 1.5, unit: 'kg' } }),
    );
  });

  it('says what to do about a quantity it cannot read', async () => {
    const { user, onSubmit } = renderD();
    const amount = screen.getByLabelText('Quantity you can give · customer asked for 5 kg');
    await user.clear(amount);
    await user.type(amount, 'lots');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Quantity must be a number, like 2.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends no price when the field is cleared', async () => {
    const { user, onSubmit } = renderD({ ping: ping({ lastPricePaise: 4500 }), shop: shop() });
    await user.clear(screen.getByLabelText('Price · optional'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith({ answer: 'yes' });
  });

  it('says what to do about a bad price and sends nothing', async () => {
    const { user, onSubmit } = renderD();
    const price = screen.getByLabelText('Price · optional');
    await user.clear(price);
    await user.type(price, 'abc');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Price must be a number, like 45.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says Not available right away, with no other fields', async () => {
    const { user, onSubmit } = renderD();
    await user.click(screen.getByRole('button', { name: 'Not available' }));
    expect(onSubmit).toHaveBeenCalledWith({ answer: 'no' });
  });

  it('offers delivery from the shop defaults, only when the shop can deliver there', async () => {
    const { user, onSubmit, unmount } = renderD();
    const sw = screen.getByRole('switch', { name: 'Offer delivery · ₹20 fee' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: { feePaise: 2000, minutes: 30 } }),
    );
    unmount();
    renderD({ ping: ping({ canDeliver: false }) });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('can switch delivery off', async () => {
    const { user, onSubmit } = renderD();
    await user.click(screen.getByRole('switch', { name: /Offer delivery/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('delivery');
  });

  it('shows a failed send in plain words and lets the shop try again', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { user } = renderD({ onSubmit });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText("Couldn't send. Check your connection and try again."),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Couldn't send. Check your connection and try again.")).toBeNull();
  });

  it('adds the shop’s own photo to a yes', async () => {
    const photos = fakePhotos({ uploadPhoto: vi.fn(async () => ({ id: 'photo-9' })) });
    const { user, onSubmit } = renderD({
      photos,
      preparePhoto: async (file: File) => file,
    });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await screen.findByRole('button', { name: 'Remove photo' });
    expect(photos.uploadPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'answer' }),
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'photo-9' }));
  });
});

function renderE(over: Partial<Parameters<typeof WantsDeliverySheet>[0]> = {}) {
  const onSubmit = vi.fn(async (_body: AnswerBody) => undefined);
  const view = renderApp(
    <WantsDeliverySheet
      ping={ping({ wantsDelivery: true, quantity, distanceBand: '1–2 km' })}
      shop={delivering}
      onSubmit={onSubmit}
      onClose={vi.fn()}
      {...over}
    />,
    'en',
  );
  return { ...view, onSubmit };
}

describe('WantsDeliverySheet (the customer wants it delivered)', () => {
  it('shows the distance caption, the title and three choices', () => {
    renderE();
    const dialog = screen.getByRole('dialog', { name: 'wheat flour · 5 kg' });
    expect(within(dialog).getByText('Wants delivery · 1–2 km')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Have it, will deliver' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: "Have it, can't deliver" })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Not available' })).toBeTruthy();
  });

  it('replaces "will deliver" with a muted note when the shop cannot deliver that far', () => {
    renderE({ ping: ping({ wantsDelivery: true, canDeliver: false }) });
    expect(screen.queryByRole('radio', { name: 'Have it, will deliver' })).toBeNull();
    expect(screen.getByText("You don't deliver this far")).toBeTruthy();
  });

  it('cannot confirm until a choice is made', () => {
    renderE();
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('asks for price, fee and time when the shop will deliver, and shows what the customer pays', async () => {
    const { user } = renderE({
      ping: ping({ wantsDelivery: true, quantity, lastPricePaise: 4000 }),
    });
    await user.click(screen.getByRole('radio', { name: 'Have it, will deliver' }));
    expect((screen.getByLabelText('Price') as HTMLInputElement).value).toBe('40');
    expect((screen.getByLabelText('Delivery fee') as HTMLInputElement).value).toBe('20');
    expect(screen.getByText('From your delivery settings')).toBeTruthy();
    expect(screen.getByRole('button', { name: '30 min' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('Customer pays cash · ₹60')).toBeTruthy();
    expect(
      screen.getByText("If the customer picks you, you're committed to deliver."),
    ).toBeTruthy();
  });

  it('confirms a delivery as yes with a fee and a time', async () => {
    const { user, onSubmit } = renderE();
    await user.click(screen.getByRole('radio', { name: 'Have it, will deliver' }));
    await user.type(screen.getByLabelText('Price'), '40');
    await user.click(screen.getByRole('button', { name: '1 hour' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledWith({
      answer: 'yes',
      pricePaise: 4000,
      delivery: { feePaise: 2000, minutes: 60 },
    });
  });

  it('needs a price before it promises delivery', async () => {
    const { user, onSubmit } = renderE();
    await user.click(screen.getByRole('radio', { name: 'Have it, will deliver' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText('Price must be a number, like 45.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('needs a fee when the shop has no standing offer, so free delivery is never an accident', async () => {
    const { user, onSubmit } = renderE({ shop: shop() });
    await user.click(screen.getByRole('radio', { name: 'Have it, will deliver' }));
    await user.type(screen.getByLabelText('Price'), '40');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText('Fee must be a number, like 20.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lets the shop set a free delivery', async () => {
    const { user, onSubmit } = renderE();
    await user.click(screen.getByRole('radio', { name: 'Have it, will deliver' }));
    await user.type(screen.getByLabelText('Price'), '40');
    const fee = screen.getByLabelText('Delivery fee');
    await user.clear(fee);
    await user.type(fee, '0');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: { feePaise: 0, minutes: 30 } }),
    );
  });

  it('confirms "have it, can’t deliver" as a plain yes and "not available" as a no', async () => {
    const first = renderE();
    await first.user.click(screen.getByRole('radio', { name: "Have it, can't deliver" }));
    await first.user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(first.onSubmit).toHaveBeenCalledWith({ answer: 'yes' });
    first.unmount();

    const second = renderE();
    await second.user.click(screen.getByRole('radio', { name: 'Not available' }));
    await second.user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(second.onSubmit).toHaveBeenCalledWith({ answer: 'no' });
  });

  it('shows a failed send in plain words', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('offline'));
    const { user } = renderE({ onSubmit });
    await user.click(screen.getByRole('radio', { name: 'Not available' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText("Couldn't send. Check your connection and try again."),
    ).toBeTruthy();
  });
});
