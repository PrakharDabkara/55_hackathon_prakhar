import { describe, expect, it } from 'vitest';
import { ping, shopOrder } from '../../test/fakes.js';
import { buildDeck, newlyAccepted } from './deck.js';
import {
  displayItemName,
  formatClock,
  formatDuration,
  formatQuantity,
  isToday,
  minutesLeft,
  ringFraction,
} from './format.js';
import { viewFromHash } from './view.js';

describe('buildDeck', () => {
  it('puts order requests first, then pings by the one that runs out soonest', () => {
    const deck = buildDeck(
      [
        ping({ id: 'late', expiresAt: '2026-10-19T10:30:00.000Z' }),
        ping({ id: 'soon', expiresAt: '2026-10-19T10:05:00.000Z' }),
      ],
      [
        shopOrder({ id: 'accepted', state: 'ACCEPTED' }),
        shopOrder({ id: 'req-b', state: 'REQUESTED', expiresAt: '2026-10-19T10:09:00.000Z' }),
        shopOrder({ id: 'req-a', state: 'REQUESTED', expiresAt: '2026-10-19T10:02:00.000Z' }),
      ],
    );
    expect(deck.map((s) => s.key)).toEqual([
      'order:req-a',
      'order:req-b',
      'ping:soon',
      'ping:late',
    ]);
  });

  it('is empty when there is nothing to answer', () => {
    expect(buildDeck([], [shopOrder({ state: 'ACCEPTED' })])).toEqual([]);
  });
});

describe('newlyAccepted', () => {
  it('finds orders that became ACCEPTED since the last look', () => {
    const seen = new Set(['a']);
    const orders = [
      shopOrder({ id: 'a', state: 'ACCEPTED' }),
      shopOrder({ id: 'b', state: 'ACCEPTED' }),
      shopOrder({ id: 'c', state: 'REQUESTED' }),
    ];
    expect(newlyAccepted(seen, orders).map((o) => o.id)).toEqual(['b']);
  });

  it('says nothing on the first look, when there is nothing to compare with', () => {
    expect(newlyAccepted(null, [shopOrder({ id: 'a', state: 'ACCEPTED' })])).toEqual([]);
  });
});

describe('formatting', () => {
  it('writes a reply time like 1m 40s', () => {
    expect(formatDuration(100)).toBe('1m 40s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(3900)).toBe('1h 5m');
    expect(formatDuration(null)).toBe('—');
  });

  it('writes a quantity with a readable unit', () => {
    expect(formatQuantity({ quantity: 5, unit: 'kg' })).toBe('5 kg');
    expect(formatQuantity({ quantity: 1.5, unit: 'l' })).toBe('1.5 L');
    expect(formatQuantity(undefined)).toBeNull();
  });

  it('counts whole minutes left, never below zero, and the ring fraction', () => {
    const now = Date.parse('2026-10-19T10:00:00.000Z');
    expect(minutesLeft('2026-10-19T10:04:10.000Z', now)).toBe(5);
    expect(minutesLeft('2026-10-19T09:00:00.000Z', now)).toBe(0);
    expect(ringFraction('2026-10-19T10:00:00.000Z', '2026-10-19T10:10:00.000Z', now)).toBe(1);
    expect(
      ringFraction('2026-10-19T10:00:00.000Z', '2026-10-19T10:10:00.000Z', now + 5 * 60_000),
    ).toBe(0.5);
    expect(
      ringFraction('2026-10-19T10:00:00.000Z', '2026-10-19T10:10:00.000Z', now + 99 * 60_000),
    ).toBe(0);
  });

  it('knows today in the shop’s local day', () => {
    const now = new Date('2026-10-19T15:00:00');
    expect(isToday('2026-10-19T01:00:00', now)).toBe(true);
    expect(isToday('2026-10-18T23:59:00', now)).toBe(false);
  });

  it('writes a clock time like 6:12 pm', () => {
    expect(formatClock('2026-10-19T18:12:00')).toMatch(/6:12\s?pm/i);
  });
});

describe('displayItemName', () => {
  it('capitalises the first letter and leaves the rest as it is', () => {
    expect(displayItemName('cumin seeds')).toBe('Cumin seeds');
    expect(displayItemName('turmeric powder')).toBe('Turmeric powder');
    expect(displayItemName('iPhone charger')).toBe('IPhone charger');
    expect(displayItemName('Already Fine')).toBe('Already Fine');
    expect(displayItemName('आटा')).toBe('आटा');
    expect(displayItemName('')).toBe('');
  });
});

describe('viewFromHash', () => {
  it('maps the hash to a view and falls back to requests', () => {
    expect(viewFromHash('#/orders')).toBe('orders');
    expect(viewFromHash('#/settings')).toBe('settings');
    expect(viewFromHash('')).toBe('requests');
    expect(viewFromHash('#/nowhere')).toBe('requests');
  });
});
