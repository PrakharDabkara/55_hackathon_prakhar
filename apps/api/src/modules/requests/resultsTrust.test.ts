import { describe, expect, it } from 'vitest';
import { rankResults, type LearnedStockResult } from '../shops/index.js';
import { buildResults } from './results.js';

const now = new Date('2026-10-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const learned = (
  shopId: string,
  distanceM: number,
  over: Partial<LearnedStockResult> = {},
): LearnedStockResult => ({
  shopId,
  name: shopId,
  distanceM,
  lat: 22.73,
  lng: 75.87,
  pricePaise: 4000,
  quantityHint: null,
  quantity: null,
  delivery: null,
  lastConfirmedAt: hoursAgo(2),
  freshness: 'Confirmed today',
  ...over,
});

// ADR-0035: what customers told us about learned stock changes how it is shown and ranked.
describe('rankResults with customer reports', () => {
  it('puts a shop with repeated wrong answers after the others, even a fresher, nearer one', () => {
    const ranked = rankResults(
      [
        learned('doubtful', 100, { doubtful: true }),
        learned('fine', 900, { lastConfirmedAt: hoursAgo(80) }),
      ],
      now,
    );
    expect(ranked.map((r) => r.shopId)).toEqual(['fine', 'doubtful']);
  });

  it('keeps freshness and distance order among shops that are not doubtful', () => {
    const ranked = rankResults(
      [
        learned('far', 900),
        learned('near', 100),
        learned('old', 50, { lastConfirmedAt: hoursAgo(80) }),
      ],
      now,
    );
    expect(ranked.map((r) => r.shopId)).toEqual(['near', 'far', 'old']);
  });
});

describe('buildResults with customer reports', () => {
  const build = (rows: LearnedStockResult[], sort?: 'distance' | 'price') =>
    buildResults({ live: [], learned: rows, targetPricePaise: null, sort, now });

  it('carries "customer verified" on learned rows only', () => {
    const [row] = build([learned('a', 100, { customerVerified: true })]);
    expect(row).toMatchObject({ source: 'learned', customerVerified: true });
    expect(build([learned('b', 100)])[0]).not.toHaveProperty('customerVerified');
  });

  it('puts a doubtful learned row last whatever the sort, and never says it is doubtful', () => {
    const rows = [
      learned('doubtful', 100, { doubtful: true, pricePaise: 1000 }),
      learned('fine', 900),
    ];
    for (const sort of ['distance', 'price'] as const) {
      const out = build(rows, sort);
      expect(out.map((r) => r.shopId)).toEqual(['fine', 'doubtful']);
      expect(JSON.stringify(out)).not.toMatch(/doubt/i);
    }
  });

  it('lets a live yes beat the doubt: the shop has just answered', () => {
    const out = buildResults({
      live: [
        {
          shopId: 'doubtful',
          name: 'doubtful',
          distanceM: 100,
          lat: 22.7,
          lng: 75.8,
          pricePaise: 4000,
          quantityHint: null,
          answeredAt: now,
        },
      ],
      learned: [learned('doubtful', 100, { doubtful: true }), learned('fine', 900)],
      targetPricePaise: null,
      sort: 'distance',
      now,
    });
    expect(out.map((r) => r.shopId)).toEqual(['doubtful', 'fine']);
    expect(out[0]).toMatchObject({ source: 'live' });
    expect(out[0]).not.toHaveProperty('customerVerified');
  });
});
