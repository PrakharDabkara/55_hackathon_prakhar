// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakePhotos, ping, shopOrder } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { Deck } from './Deck.js';
import { OrderSlip } from './OrderSlip.js';
import { PingSlip } from './PingSlip.js';
import { TimeRing } from './TimeRing.js';

const NOW = Date.parse('2026-10-16T10:05:00.000Z');

describe('TimeRing', () => {
  it('shows the minutes left and turns urgent under two minutes', () => {
    const { rerender } = renderApp(
      <TimeRing
        startedAt="2026-10-16T10:00:00.000Z"
        expiresAt="2026-10-16T10:15:00.000Z"
        now={NOW}
      />,
      'en',
    );
    expect(screen.getByText('10m').className).not.toContain('urgent');
    rerender(
      <TimeRing
        startedAt="2026-10-16T10:00:00.000Z"
        expiresAt="2026-10-16T10:06:00.000Z"
        now={NOW}
      />,
    );
    expect(screen.getByText('1m').closest('.sh-ring')?.className).toContain('sh-ring--urgent');
  });
});

describe('PingSlip', () => {
  const quantity = { quantity: 5, unit: 'kg' };

  it('shows the item, quantity, distance and time left, and nothing about the customer', () => {
    renderApp(<PingSlip ping={ping({ quantity })} now={NOW} onAnswer={vi.fn()} />, 'en');
    expect(screen.getByText('Wheat flour')).toBeTruthy();
    expect(screen.getByText('5 kg')).toBeTruthy();
    expect(screen.getByText('under 1 km')).toBeTruthy();
    expect(screen.getByText('Reply in')).toBeTruthy();
    expect(screen.getByText('10m')).toBeTruthy();
    expect(screen.queryByText(/delivered/i)).toBeNull();
  });

  it("shows the customer's everyday word large, with the English name small underneath", () => {
    renderApp(
      <PingSlip
        ping={ping({
          item: { slug: 'maida', nameEn: 'refined flour', nameHi: 'मैदा' },
          displayName: 'Maida',
        })}
        now={NOW}
        onAnswer={vi.fn()}
      />,
      'en',
    );
    const large = screen.getByRole('heading', { name: 'Maida' });
    expect(large.className).toContain('sh-parchi__item');
    const small = screen.getByText('Refined flour');
    expect(small.className).toContain('sh-parchi__alias');
    expect(large.compareDocumentPosition(small) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows only the English name when no everyday word matched', () => {
    renderApp(<PingSlip ping={ping()} now={NOW} onAnswer={vi.fn()} />, 'en');
    expect(screen.getByRole('heading', { name: 'Wheat flour' })).toBeTruthy();
    expect(document.querySelector('.sh-parchi__alias')).toBeNull();
  });

  it('says "May not be your usual stock" on an uncategorised request, and not otherwise', () => {
    const first = renderApp(
      <PingSlip ping={ping({ misc: true })} now={NOW} onAnswer={vi.fn()} />,
      'en',
    );
    expect(screen.getByText('May not be your usual stock')).toBeTruthy();
    first.unmount();
    renderApp(<PingSlip ping={ping()} now={NOW} onAnswer={vi.fn()} />, 'en');
    expect(screen.queryByText('May not be your usual stock')).toBeNull();
  });

  it('opens the answer sheet from the one primary button', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingSlip ping={ping()} now={NOW} onAnswer={onAnswer} />, 'en');
    const button = screen.getByRole('button', { name: 'Answer' });
    expect(button.className).toContain('sh-btn--primary');
    await user.click(button);
    expect(onAnswer).toHaveBeenCalled();
  });

  it('shows the customer photo only when the ping carries one', async () => {
    const photos = fakePhotos();
    const { rerender } = renderApp(
      <PingSlip ping={ping()} now={NOW} photos={photos} onAnswer={vi.fn()} />,
      'en',
    );
    expect(photos.photoSrc).not.toHaveBeenCalled();
    rerender(
      <PingSlip ping={ping({ photoId: 'ph-1' })} now={NOW} photos={photos} onAnswer={vi.fn()} />,
    );
    expect(await screen.findByAltText('Photo of what the customer wants')).toBeTruthy();
  });

  it('says a delivery is wanted, with the stamp and cash on delivery', () => {
    renderApp(<PingSlip ping={ping({ wantsDelivery: true })} now={NOW} onAnswer={vi.fn()} />, 'en');
    expect(screen.getByText('The customer wants this delivered')).toBeTruthy();
    expect(screen.getByText('Delivery').className).toContain('sh-delivery-stamp');
    expect(screen.getByText('Cash on delivery')).toBeTruthy();
  });

  it('puts a stamp on the slip once it is answered, and stops the button', () => {
    renderApp(<PingSlip ping={ping()} now={NOW} stamp="yes" onAnswer={vi.fn()} />, 'en');
    expect(screen.getByText('Answered')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('OrderSlip', () => {
  const order = shopOrder({
    contactName: 'Ravi',
    lines: [
      { name: 'sugar', count: 2, pricePaise: 4500 },
      { name: 'tea', count: 1, pricePaise: null },
    ],
    itemsTotalPaise: 9000,
    unknownPriceCount: 1,
    feePaise: 3000,
    note: 'Ring the bell twice',
  });

  it('shows the everyday word of a line large with the English name small', () => {
    renderApp(
      <OrderSlip
        order={shopOrder({
          lines: [{ name: 'refined flour', displayName: 'Maida', count: 2, pricePaise: 4500 }],
        })}
        now={NOW}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
      'en',
    );
    expect(screen.getByText(/2 × Maida/)).toBeTruthy();
    expect(screen.getByText('Refined flour').className).toContain('sh-parchi__alias');
  });

  it('lists the items with prices, the fee, a dashed rule, the total and the note', () => {
    renderApp(<OrderSlip order={order} now={NOW} onAccept={vi.fn()} onDecline={vi.fn()} />, 'en');
    expect(screen.getByText(/2 × Sugar/)).toBeTruthy();
    expect(screen.getByText('₹90')).toBeTruthy();
    expect(screen.getByText('Price not set')).toBeTruthy();
    expect(screen.getAllByText('Delivery')).toHaveLength(2);
    expect(screen.getByText('₹30')).toBeTruthy();
    expect(screen.getByText('Total').nextSibling?.textContent).toBe('₹120');
    expect(screen.getByText('“Ring the bell twice”')).toBeTruthy();
    expect(screen.getByText('5m')).toBeTruthy();
  });

  it('never shows who the customer is before the order is accepted', () => {
    renderApp(<OrderSlip order={order} now={NOW} onAccept={vi.fn()} onDecline={vi.fn()} />, 'en');
    expect(screen.queryByText(/Ravi/)).toBeNull();
  });

  it('declines and accepts', async () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const { user } = renderApp(
      <OrderSlip order={order} now={NOW} onAccept={onAccept} onDecline={onDecline} />,
      'en',
    );
    expect(screen.getByRole('button', { name: 'Decline' }).className).toContain('sh-btn--neutral');
    expect(screen.getByRole('button', { name: 'Accept' }).className).toContain('sh-btn--ink');
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy', () => {
    renderApp(
      <OrderSlip order={order} now={NOW} busy onAccept={vi.fn()} onDecline={vi.fn()} />,
      'en',
    );
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('ruled lines', () => {
  it('rule only the handwritten block of a question: the item and the quantity, not the caption or the button', () => {
    renderApp(
      <PingSlip
        ping={ping({ quantity: { quantity: 5, unit: 'kg' } })}
        now={NOW}
        onAnswer={vi.fn()}
      />,
      'en',
    );
    const ruled = document.querySelector('.sh-parchi__ruled') as HTMLElement;
    expect(ruled.textContent).toContain('Wheat flour');
    expect(ruled.textContent).toContain('5 kg');
    expect(ruled.querySelector('button')).toBeNull();
    expect(ruled.textContent).not.toContain('under 1 km');
  });

  it('rule the items of an order, and leave the total row and the buttons bare', () => {
    renderApp(
      <OrderSlip order={shopOrder()} now={NOW} onAccept={vi.fn()} onDecline={vi.fn()} />,
      'en',
    );
    const ruled = document.querySelector('.sh-parchi__ruled') as HTMLElement;
    expect(ruled.textContent).toContain('2 × Sugar');
    expect(ruled.textContent).not.toContain('Total');
    expect(ruled.querySelector('button')).toBeNull();
  });
});

describe('Deck', () => {
  const slides = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `k${i}`, node: <p>slide {i}</p> }));

  it('shows every slide and one dot each, up to seven, then +N', () => {
    renderApp(<Deck slides={slides(9)} index={0} onIndexChange={vi.fn()} />, 'en');
    expect(screen.getAllByText(/slide \d/)).toHaveLength(9);
    expect(document.querySelectorAll('.sh-dot')).toHaveLength(7);
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('marks the current dot', () => {
    renderApp(<Deck slides={slides(3)} index={1} onIndexChange={vi.fn()} />, 'en');
    const dots = [...document.querySelectorAll('.sh-dot')];
    expect(dots.map((d) => d.getAttribute('aria-current'))).toEqual([null, 'true', null]);
  });

  it('moves with the arrow keys while it has focus, and stops at the ends', async () => {
    const onIndexChange = vi.fn();
    const { user, rerender } = renderApp(
      <Deck slides={slides(3)} index={0} onIndexChange={onIndexChange} />,
      'en',
    );
    screen.getByRole('group', { name: 'Requests' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    await user.keyboard('{ArrowLeft}');
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    rerender(<Deck slides={slides(3)} index={2} onIndexChange={onIndexChange} />);
    await user.keyboard('{ArrowRight}');
    expect(onIndexChange).toHaveBeenCalledTimes(1);
  });

  it('leaves a peek of the next slip behind the current one, and none behind the last', () => {
    const { rerender } = renderApp(
      <Deck slides={slides(3)} index={0} onIndexChange={vi.fn()} />,
      'en',
    );
    expect(document.querySelectorAll('.sh-peek')).toHaveLength(1);
    rerender(<Deck slides={slides(3)} index={2} onIndexChange={vi.fn()} />);
    expect(document.querySelectorAll('.sh-peek')).toHaveLength(0);
  });
});
