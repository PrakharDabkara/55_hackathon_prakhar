import { describe, expect, it } from 'vitest';
import { rankAnswers } from './rank.js';

const a = (shopId: string, haveCount: number, distanceM: number, totalPaise: number) => ({
  shopId,
  haveCount,
  distanceM,
  totalPaise,
});

describe('rankAnswers (ADR-0055 rule 9)', () => {
  it('puts the shop with more "have" lines first, whatever the distance or price', () => {
    const ranked = rankAnswers([a('far-many', 3, 1500, 90000), a('near-few', 1, 100, 100)]);
    expect(ranked.map((x) => x.shopId)).toEqual(['far-many', 'near-few']);
  });

  it('then the nearer shop', () => {
    const ranked = rankAnswers([a('b', 2, 900, 100), a('a', 2, 300, 99999)]);
    expect(ranked.map((x) => x.shopId)).toEqual(['a', 'b']);
  });

  it('then the cheaper total', () => {
    const ranked = rankAnswers([a('dear', 2, 300, 5000), a('cheap', 2, 300, 4000)]);
    expect(ranked.map((x) => x.shopId)).toEqual(['cheap', 'dear']);
  });

  it('is stable for a full tie and does not change its input', () => {
    const input = [a('x', 1, 1, 1), a('y', 1, 1, 1)];
    expect(rankAnswers(input).map((r) => r.shopId)).toEqual(['x', 'y']);
    expect(input.map((r) => r.shopId)).toEqual(['x', 'y']);
  });
});
