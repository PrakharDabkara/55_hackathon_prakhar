// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import { shop, shopListParchi } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { ListSlip } from './ListSlip.js';

const NOW = Date.parse('2026-10-16T10:05:00.000Z');

function setup(
  over: Partial<Parameters<typeof ListSlip>[0]> = {},
  parchiOver: Parameters<typeof shopListParchi>[0] = {},
) {
  const onSubmit = vi.fn(async () => undefined);
  const view = renderApp(
    <ListSlip
      parchi={shopListParchi(parchiOver)}
      shop={shop()}
      now={NOW}
      onSubmit={onSubmit}
      {...over}
    />,
    'en',
  );
  return { ...view, onSubmit };
}

describe('ListSlip: reading it', () => {
  it('shows the stamp, the distance band, the time ring and the instruction', () => {
    setup();
    expect(screen.getByText('A list · 3')).toBeTruthy();
    expect(screen.getByText('under 1 km')).toBeTruthy();
    expect(screen.getByText('Tick what you have')).toBeTruthy();
    expect(screen.getByText('Reply in')).toBeTruthy();
    expect(screen.getByText('10m')).toBeTruthy();
    expect(screen.queryByText('The customer would like delivery')).toBeNull();
  });

  it('says so when the customer would like delivery', () => {
    setup({}, { wantsDelivery: true });
    expect(screen.getByText('The customer would like delivery')).toBeTruthy();
  });

  it('one checkbox row per line, with the everyday word and last price underneath', () => {
    setup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    const sugar = screen.getByRole('checkbox', { name: /Sugar/ });
    expect(sugar.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Chini')).toBeTruthy();
    expect(screen.getByText('Last time you said ₹45')).toBeTruthy();
  });

  it('groups the "other" lines apart, under their own divider', () => {
    setup();
    const divider = screen.getByText('Other · asked to all shops');
    const group = divider.closest('[data-group="other"]') as HTMLElement;
    expect(within(group).getByRole('checkbox', { name: /Tractor bolt/ })).toBeTruthy();
    expect(within(group).queryByRole('checkbox', { name: /Sugar/ })).toBeNull();
  });

  it('has no "other" divider when every line is a category line', () => {
    setup({}, { lines: [shopListParchi().lines[0]!] });
    expect(screen.queryByText('Other · asked to all shops')).toBeNull();
  });
});

describe('ListSlip: ticking', () => {
  it('unticked lines say "Tick to add"; ticking shows a price field, prefilled, and focuses it', async () => {
    const { user } = setup();
    expect(screen.getAllByText('Tick to add')).toHaveLength(3);
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    const price = screen.getByLabelText('Price for Sugar') as HTMLInputElement;
    expect(price.value).toBe('45');
    expect(price.getAttribute('inputmode')).toBe('numeric');
    expect(document.activeElement).toBe(price);
    expect(screen.getAllByText('Tick to add')).toHaveLength(2);
  });

  it('updates "You have X of N" and the total as prices are typed', async () => {
    const { user } = setup();
    expect(screen.getByText('You have 0 of 3')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('checkbox', { name: /Ball pen/ }));
    await user.type(screen.getByLabelText('Price for Ball pen'), '12');
    expect(screen.getByText('You have 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Total').textContent).toBe('₹57');
  });

  it('the checkbox row works from the keyboard', async () => {
    const { user } = setup();
    screen.getByRole('checkbox', { name: /Ball pen/ }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: /Ball pen/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('ListSlip: delivery', () => {
  it('offers "I can deliver this list" only when the customer is in reach', () => {
    setup({}, { canDeliver: false });
    expect(screen.queryByRole('switch', { name: /I can deliver this list/ })).toBeNull();
  });

  it('shows a fee field when it is on, prefilled from the shop settings', async () => {
    const { user } = setup({ shop: shop({ defaultFeePaise: 2000 }) });
    expect(screen.queryByLabelText('Delivery fee')).toBeNull();
    expect(screen.getByText('One fee for everything')).toBeTruthy();
    await user.click(screen.getByRole('switch', { name: /I can deliver this list/ }));
    expect((screen.getByLabelText('Delivery fee') as HTMLInputElement).value).toBe('20');
  });
});

describe('ListSlip: sending', () => {
  it('sends the ticked lines with their prices and the fee', async () => {
    const { user, onSubmit } = setup({ shop: shop({ defaultFeePaise: 2000 }) });
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('switch', { name: /I can deliver this list/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onSubmit).toHaveBeenCalledWith({
      lines: [
        { lineId: 'l1', have: true, priceRupees: 45 },
        { lineId: 'l2', have: false },
        { lineId: 'l3', have: false },
      ],
      canDeliver: true,
      deliveryFeeRupees: 20,
    });
  });

  it('shows "Add a price" next to the field, and sends nothing', async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole('checkbox', { name: /Ball pen/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onSubmit).not.toHaveBeenCalled();
    const price = screen.getByLabelText('Price for Ball pen');
    expect(price.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Add a price')).toBeTruthy();
    // Typing clears it.
    await user.type(price, '9');
    expect(screen.queryByText('Add a price')).toBeNull();
  });

  it("shows the server's price_required next to the fields too", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(400, 'price_required', 'x'));
    const { user } = setup({ onSubmit });
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    // The server disagreed with a price the screen thought was fine: a message at the button.
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('says what to do when the customer is out of reach (cannot_deliver)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, 'cannot_deliver', 'x'));
    const { user } = setup({ onSubmit, shop: shop({ deliversDefault: true }) });
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText(/too far to deliver/i)).toBeTruthy();
  });

  it('asks in the page before sending "none of these", with no browser dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onSubmit).not.toHaveBeenCalled();
    const ask = screen.getByRole('alertdialog', { name: "Send 'none of these'?" });
    await user.click(within(ask).getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith({
      lines: [
        { lineId: 'l1', have: false },
        { lineId: 'l2', have: false },
        { lineId: 'l3', have: false },
      ],
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('"Go back" on that question sends nothing', async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('warns that ticked items are a promise', () => {
    setup();
    expect(
      screen.getByText("If the customer picks you, you're committed to the ticked items."),
    ).toBeTruthy();
  });

  it('keeps the button from firing twice while sending', async () => {
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = setup({ onSubmit });
    await user.click(screen.getByRole('checkbox', { name: /Sugar/ }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(
      (screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    finish();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe('ListSlip: after', () => {
  it('shows the ANSWERED stamp and stops the button', () => {
    setup({ stamp: 'answered' });
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a closed list says so and offers nothing to tick', () => {
    setup({ stamp: 'closed' });
    expect(screen.getByText('This list has closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
