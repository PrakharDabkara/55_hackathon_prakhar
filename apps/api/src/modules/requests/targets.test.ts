import { describe, expect, it } from 'vitest';
import { selectPingTargets, type Candidate } from './targets.js';

const shop = (shopId: string, distanceM: number, categories = ['grocery']): Candidate => ({
  shopId,
  categories,
  distanceM,
});

const opts = {
  itemCategories: ['grocery'],
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

  it('keeps a shop that shares any one of the item categories (fevicol: hardware and stationery)', () => {
    const picked = selectPingTargets(
      [
        shop('stationery-shop', 200, ['stationery']),
        shop('hardware-shop', 300, ['hardware']),
        shop('grocery-shop', 100, ['grocery']),
      ],
      { ...opts, itemCategories: ['hardware', 'stationery'] },
    );
    expect(picked.map((s) => s.shopId)).toEqual(['stationery-shop', 'hardware-shop']);
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
    expect(selectPingTargets(input, { ...opts, itemCategories: ['stationery'] })).toEqual([]);
    selectPingTargets(input, opts);
    expect(input.map((s) => s.shopId)).toEqual(['b', 'a']);
  });

  describe('fallback to any category (ADR-0028)', () => {
    const unrelated = [
      shop('h1', 100, ['hardware']),
      shop('h2', 200, ['hardware']),
      shop('h3', 300, ['hardware']),
      shop('h4', 400, ['hardware']),
    ];

    it('tops up with the nearest shops of any category when fewer than 3 match', () => {
      const picked = selectPingTargets([shop('g1', 900), ...unrelated], {
        ...opts,
        itemCategories: ['stationery'],
        minTargets: 3,
      });
      expect(picked.map((s) => s.shopId)).toEqual(['h1', 'h2', 'h3']);
    });

    it('keeps the category matches first, and only fills up to the minimum', () => {
      const picked = selectPingTargets(
        [shop('s1', 900, ['stationery']), shop('s2', 1500, ['stationery']), ...unrelated],
        { ...opts, itemCategories: ['stationery'], minTargets: 3 },
      );
      expect(picked.map((s) => s.shopId)).toEqual(['s1', 's2', 'h1']);
    });

    it('does nothing when enough shops match', () => {
      const matching = [1, 2, 3].map((n) => shop(`s${n}`, n * 100, ['stationery']));
      const picked = selectPingTargets([...matching, ...unrelated], {
        ...opts,
        itemCategories: ['stationery'],
        minTargets: 3,
      });
      expect(picked.map((s) => s.shopId)).toEqual(['s1', 's2', 's3']);
    });

    it('still respects the radius, the exclusions and max', () => {
      const picked = selectPingTargets(
        [shop('far', 2600, ['hardware']), shop('known', 50, ['hardware']), ...unrelated],
        {
          ...opts,
          itemCategories: ['stationery'],
          minTargets: 3,
          excludeShopIds: new Set(['known']),
          max: 2,
        },
      );
      expect(picked.map((s) => s.shopId)).toEqual(['h1', 'h2']);
    });

    it('without minTargets nothing changes (the old behaviour)', () => {
      expect(selectPingTargets(unrelated, { ...opts, itemCategories: ['stationery'] })).toEqual([]);
    });
  });
});

describe('selectPingTargets: the general store (S-06)', () => {
  it('asks a general store about household, personal care and stationery items', () => {
    for (const itemCategories of [['household_kitchen'], ['personal_care'], ['stationery']]) {
      const picked = selectPingTargets(
        [shop('general', 200, ['general_store']), shop('grocer', 100, ['grocery'])],
        { ...opts, itemCategories },
      );
      expect(picked.map((s) => s.shopId)).toEqual(['general']);
    }
  });

  it('does not ask it about a hardware item', () => {
    const picked = selectPingTargets([shop('general', 200, ['general_store'])], {
      ...opts,
      itemCategories: ['hardware'],
    });
    expect(picked).toEqual([]);
  });

  it('counts it as a shop of the kind, so no other kind is pulled in to fill up', () => {
    const picked = selectPingTargets(
      [shop('general', 200, ['general_store']), shop('hardware', 100, ['hardware'])],
      { ...opts, itemCategories: ['household_kitchen'], minTargets: 1 },
    );
    expect(picked.map((s) => s.shopId)).toEqual(['general']);
  });
});
