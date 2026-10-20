import { describe, expect, it } from 'vitest';
import { result } from '../test/fakes.js';
import {
  bestPriceShopId,
  daysSince,
  directionsUrl,
  learnedReplies,
  liveReplies,
  pinsFor,
  sortResults,
} from './results.js';

describe('sortResults', () => {
  const a = result({ shopId: 'a', pricePaise: 6000, distanceM: 100 });
  const b = result({ shopId: 'b', pricePaise: 4000, distanceM: 900 });
  const c = result({ shopId: 'c', pricePaise: null, distanceM: 50 });

  it('by price puts the cheapest first and shops with no price last', () => {
    expect(sortResults([a, b, c], 'price').map((r) => r.shopId)).toEqual(['b', 'a', 'c']);
  });

  it('by distance puts the nearest first', () => {
    expect(sortResults([a, b, c], 'distance').map((r) => r.shopId)).toEqual(['c', 'a', 'b']);
  });

  it('breaks a price tie by distance, and leaves the input alone', () => {
    const input = [
      result({ shopId: 'far', pricePaise: 5000, distanceM: 800 }),
      result({ shopId: 'near', pricePaise: 5000, distanceM: 100 }),
    ];
    expect(sortResults(input, 'price').map((r) => r.shopId)).toEqual(['near', 'far']);
    expect(input.map((r) => r.shopId)).toEqual(['far', 'near']);
  });
});

describe('pinsFor', () => {
  it('makes one pin per shop: live answers green, learned stock blue', () => {
    const pins = pinsFor([
      result({ shopId: 'a', source: 'live', lat: 1, lng: 2, name: 'A' }),
      result({ shopId: 'b', source: 'learned', lat: 3, lng: 4, name: 'B' }),
    ]);
    expect(pins).toEqual([
      { id: 'a', lat: 1, lng: 2, kind: 'live', label: 'A' },
      { id: 'b', lat: 3, lng: 4, kind: 'learned', label: 'B' },
    ]);
  });
});

describe('directionsUrl', () => {
  it('opens Google Maps directions to the shop', () => {
    expect(directionsUrl(22.7196, 75.8577)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=22.7196,75.8577',
    );
  });
});

describe('liveReplies', () => {
  it('keeps live answers only: price first (no price last), then distance', () => {
    const rows = liveReplies([
      result({ shopId: 'l', source: 'learned', pricePaise: 100 }),
      result({ shopId: 'none', pricePaise: null, distanceM: 10 }),
      result({ shopId: 'far', pricePaise: 5000, distanceM: 900 }),
      result({ shopId: 'near', pricePaise: 5000, distanceM: 100 }),
      result({ shopId: 'cheap', pricePaise: 4000, distanceM: 2000 }),
    ]);
    expect(rows.map((r) => r.shopId)).toEqual(['cheap', 'near', 'far', 'none']);
  });
});

describe('learnedReplies', () => {
  it('keeps remembered answers only, newest first', () => {
    const rows = learnedReplies([
      result({ shopId: 'live', source: 'live' }),
      result({ shopId: 'old', source: 'learned', lastConfirmedAt: '2026-10-10T10:00:00.000Z' }),
      result({ shopId: 'new', source: 'learned', lastConfirmedAt: '2026-10-15T10:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.shopId)).toEqual(['new', 'old']);
  });
});

describe('bestPriceShopId', () => {
  const live = (...prices: (number | null)[]) =>
    liveReplies(prices.map((p, i) => result({ shopId: `s${i}`, pricePaise: p, distanceM: i })));

  it('names the shop with the strictly lowest price', () => {
    expect(bestPriceShopId(live(5000, 4000, 6000))).toBe('s1');
  });
  it('names nobody when the two lowest prices are equal', () => {
    expect(bestPriceShopId(live(4000, 4000, 6000))).toBeNull();
  });
  it('names nobody when there is nothing to compare with', () => {
    expect(bestPriceShopId(live(4000))).toBeNull();
    expect(bestPriceShopId(live(4000, null))).toBeNull();
    expect(bestPriceShopId(live(null, null))).toBeNull();
    expect(bestPriceShopId([])).toBeNull();
  });
  it('ignores replies with no price when others can be compared', () => {
    expect(bestPriceShopId(live(null, 4000, 5000))).toBe('s1');
  });
});

describe('daysSince', () => {
  const now = new Date('2026-10-16T10:00:00.000Z').getTime();
  it('counts whole days, 0 for today', () => {
    expect(daysSince('2026-10-16T01:00:00.000Z', now)).toBe(0);
    expect(daysSince('2026-10-15T09:00:00.000Z', now)).toBe(1);
    expect(daysSince('2026-10-11T09:00:00.000Z', now)).toBe(5);
    expect(daysSince('2026-10-17T09:00:00.000Z', now)).toBe(0);
  });
});
