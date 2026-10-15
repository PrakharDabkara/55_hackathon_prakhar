import { describe, expect, it } from 'vitest';
import { freshnessLabel, rankResults, stockExpiry, type LearnedStockResult } from './stock.js';

const now = new Date('2026-10-16T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('stockExpiry', () => {
  const confirmed = new Date('2026-10-16T10:00:00Z');

  it('is 7 days after confirmation by default', () => {
    expect(stockExpiry(confirmed, null)).toEqual(new Date('2026-10-23T10:00:00Z'));
    expect(stockExpiry(confirmed, 'plenty')).toEqual(new Date('2026-10-23T10:00:00Z'));
  });

  it('is 3 days when the shop said "a few"', () => {
    expect(stockExpiry(confirmed, 'few')).toEqual(new Date('2026-10-19T10:00:00Z'));
  });
});

describe('freshnessLabel', () => {
  it('says "Confirmed today" within the last day', () => {
    expect(freshnessLabel(ago(5 * 60_000), now)).toBe('Confirmed today');
    expect(freshnessLabel(ago(23 * HOUR), now)).toBe('Confirmed today');
  });

  it('says "Had it yesterday" and "Had it N days ago" after that', () => {
    expect(freshnessLabel(ago(25 * HOUR), now)).toBe('Had it yesterday');
    expect(freshnessLabel(ago(2 * DAY + HOUR), now)).toBe('Had it 2 days ago');
    expect(freshnessLabel(ago(6 * DAY), now)).toBe('Had it 6 days ago');
  });

  it('treats a time slightly in the future (clock skew) as today', () => {
    expect(freshnessLabel(new Date(now.getTime() + 60_000), now)).toBe('Confirmed today');
  });
});

describe('rankResults', () => {
  const result = (shopId: string, distanceM: number, confirmedAgo: number): LearnedStockResult => ({
    shopId,
    name: shopId,
    lat: 22.7,
    lng: 75.8,
    distanceM,
    pricePaise: null,
    quantityHint: null,
    lastConfirmedAt: ago(confirmedAgo),
    freshness: '',
  });

  it('puts fresher buckets first (today, last 3 days, older), then nearest', () => {
    const ranked = rankResults(
      [
        result('old-near', 100, 5 * DAY),
        result('today-far', 1900, 2 * HOUR),
        result('recent-near', 200, 2 * DAY),
        result('today-near', 800, 20 * HOUR),
        result('recent-far', 1500, DAY + HOUR),
        result('old-far', 1000, 4 * DAY),
      ],
      now,
    );

    expect(ranked.map((r) => r.shopId)).toEqual([
      'today-near',
      'today-far',
      'recent-near',
      'recent-far',
      'old-near',
      'old-far',
    ]);
  });

  it('does not modify its input', () => {
    const input = [result('b', 200, 5 * DAY), result('a', 100, 2 * HOUR)];
    rankResults(input, now);
    expect(input.map((r) => r.shopId)).toEqual(['b', 'a']);
  });
});
