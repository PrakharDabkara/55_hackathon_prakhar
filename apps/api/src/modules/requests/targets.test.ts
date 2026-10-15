import { describe, expect, it } from 'vitest';
import { selectPingTargets, type Candidate } from './targets.js';

const shop = (shopId: string, distanceM: number, categories = ['grocery']): Candidate => ({
  shopId,
  categories,
  distanceM,
});

const opts = {
  itemCategory: 'grocery',
  radiusM: 2000,
  excludeShopIds: new Set<string>(),
  max: 10,
};

describe('selectPingTargets', () => {
  it('keeps shops in the radius whose categories include the item category, nearest first', () => {
    const picked = selectPingTargets(
      [
        shop('far', 1800),
        shop('near', 300),
        shop('two-cats', 900, ['hardware', 'grocery']),
        shop('wrong-category', 100, ['hardware']),
        shop('outside', 2500),
      ],
      opts,
    );
    expect(picked.map((s) => s.shopId)).toEqual(['near', 'two-cats', 'far']);
  });

  it('includes a shop exactly on the radius', () => {
    expect(selectPingTargets([shop('edge', 2000)], opts)).toHaveLength(1);
  });

  it('excludes shops that already have the item in learned stock', () => {
    const picked = selectPingTargets([shop('a', 100), shop('b', 200), shop('c', 300)], {
      ...opts,
      excludeShopIds: new Set(['a', 'c']),
    });
    expect(picked.map((s) => s.shopId)).toEqual(['b']);
  });

  it('caps the list at max, keeping the nearest', () => {
    const many = Array.from({ length: 15 }, (_, i) => shop(`s${i}`, (15 - i) * 100));
    const picked = selectPingTargets(many, { ...opts, max: 10 });
    expect(picked).toHaveLength(10);
    expect(picked[0]?.shopId).toBe('s14');
    expect(picked[9]?.shopId).toBe('s5');
  });

  it('returns nothing when nothing qualifies, and does not modify its input', () => {
    const input = [shop('b', 500), shop('a', 100)];
    expect(selectPingTargets(input, { ...opts, itemCategory: 'stationery' })).toEqual([]);
    selectPingTargets(input, opts);
    expect(input.map((s) => s.shopId)).toEqual(['b', 'a']);
  });
});
