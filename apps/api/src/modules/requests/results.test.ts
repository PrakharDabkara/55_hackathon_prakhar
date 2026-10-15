import { describe, expect, it } from 'vitest';
import type { LearnedStockResult } from '../shops/index.js';
import { buildResults, liveLabel, type LiveAnswer } from './results.js';

const now = new Date('2026-10-16T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const live = (
  shopId: string,
  distanceM: number,
  pricePaise: number | null,
  ageMin = 5,
): LiveAnswer => ({
  shopId,
  name: shopId,
  distanceM,
  pricePaise,
  quantityHint: null,
  answeredAt: minutesAgo(ageMin),
});

const learned = (
  shopId: string,
  distanceM: number,
  pricePaise: number | null,
): LearnedStockResult => ({
  shopId,
  name: shopId,
  distanceM,
  pricePaise,
  quantityHint: null,
  lastConfirmedAt: minutesAgo(60 * 30),
  freshness: 'Had it yesterday',
});

const base = { now, targetPricePaise: null, sort: undefined } as const;

describe('liveLabel', () => {
  it('says how long ago the shop confirmed', () => {
    expect(liveLabel(minutesAgo(0), now)).toBe('Confirmed just now');
    expect(liveLabel(minutesAgo(12), now)).toBe('Confirmed 12 min ago');
    expect(liveLabel(minutesAgo(59), now)).toBe('Confirmed 59 min ago');
    expect(liveLabel(minutesAgo(180), now)).toBe('Confirmed 3 h ago');
  });
});

describe('buildResults', () => {
  it('merges live answers with learned stock; a live answer replaces the same shop learned row', () => {
    const results = buildResults({
      ...base,
      live: [live('A', 500, 6000)],
      learned: [learned('A', 500, 5500), learned('B', 900, 5000)],
    });
    expect(results.map((r) => [r.shopId, r.source, r.pricePaise])).toEqual([
      ['A', 'live', 6000],
      ['B', 'learned', 5000],
    ]);
    expect(results[0]?.freshness).toBe('Confirmed 5 min ago');
    expect(results[1]?.freshness).toBe('Had it yesterday');
  });

  it('sorts by distance by default when there is no target price', () => {
    const results = buildResults({
      ...base,
      live: [live('far', 1500, 1000)],
      learned: [learned('near', 200, 9000), learned('mid', 800, null)],
    });
    expect(results.map((r) => r.shopId)).toEqual(['near', 'mid', 'far']);
  });

  it('sorts by price by default when a target price is set: cheapest first, unknown price last', () => {
    const results = buildResults({
      ...base,
      targetPricePaise: 20000,
      live: [live('A', 900, 6000)],
      learned: [learned('B', 100, null), learned('C', 500, 4500), learned('D', 300, 4500)],
    });
    expect(results.map((r) => r.shopId)).toEqual(['D', 'C', 'A', 'B']);
  });

  it('honours an explicit sort over the default', () => {
    const input = {
      ...base,
      targetPricePaise: 20000,
      live: [live('A', 900, 6000)],
      learned: [learned('B', 100, 9000)],
    };
    expect(buildResults({ ...input, sort: 'distance' }).map((r) => r.shopId)).toEqual(['B', 'A']);
    expect(buildResults({ ...input, sort: 'price' }).map((r) => r.shopId)).toEqual(['A', 'B']);
    expect(
      buildResults({ ...input, targetPricePaise: null, sort: 'price' }).map((r) => r.shopId),
    ).toEqual(['A', 'B']);
  });

  it('shows the saving only when the price is below the target', () => {
    const results = buildResults({
      ...base,
      targetPricePaise: 20000,
      live: [live('A', 500, 6000)],
      learned: [
        learned('same', 600, 20000),
        learned('dearer', 700, 25000),
        learned('none', 800, null),
      ],
    });
    const byShop = Object.fromEntries(results.map((r) => [r.shopId, r.savingsPaise]));
    expect(byShop).toEqual({ A: 14000, same: undefined, dearer: undefined, none: undefined });
    expect('savingsPaise' in (results.find((r) => r.shopId === 'same') ?? {})).toBe(false);
  });

  it('returns an empty list for no answers', () => {
    expect(buildResults({ ...base, live: [], learned: [] })).toEqual([]);
  });
});
