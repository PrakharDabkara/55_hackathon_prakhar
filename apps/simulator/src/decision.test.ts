import { describe, expect, it } from 'vitest';
import { decide, makeProfile, type ShopProfile } from './decision.ts';
import { createRng, hashSeed } from './rng.ts';

const profile = (overrides: Partial<ShopProfile> = {}): ShopProfile => ({
  replyProbability: 0.6,
  alwaysNo: false,
  ...overrides,
});
const ping = { pingId: 'p1', shopId: 's1', refPricePaise: 5000 };

describe('createRng', () => {
  it('gives the same numbers for the same seed, different ones for another', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const run = (r: () => number) => Array.from({ length: 5 }, r);
    expect(run(a)).toEqual(run(b));
    expect(run(createRng(7))).not.toEqual(run(c));
  });

  it('stays in [0, 1)', () => {
    const r = createRng(1);
    for (let i = 0; i < 10_000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('is stable and depends on every part', () => {
    expect(hashSeed(1, 'shop-a')).toBe(hashSeed(1, 'shop-a'));
    expect(hashSeed(1, 'shop-a')).not.toBe(hashSeed(2, 'shop-a'));
    expect(hashSeed(1, 'shop-a')).not.toBe(hashSeed(1, 'shop-b'));
  });
});

describe('makeProfile', () => {
  it('draws a reply probability between 0.3 and 0.9', () => {
    const rng = createRng(1);
    for (let i = 0; i < 2000; i++) {
      const p = makeProfile(rng);
      expect(p.replyProbability).toBeGreaterThanOrEqual(0.3);
      expect(p.replyProbability).toBeLessThanOrEqual(0.9);
    }
  });

  it('makes about 5 % of shops always say no', () => {
    const rng = createRng(2);
    const n = 5000;
    const no = Array.from({ length: n }, () => makeProfile(rng)).filter((p) => p.alwaysNo).length;
    expect(no / n).toBeGreaterThan(0.035);
    expect(no / n).toBeLessThan(0.065);
  });

  it('is the same for the same shop every run (seeded by seed and shop id)', () => {
    expect(makeProfile(createRng(hashSeed(5, 'shop-1')))).toEqual(
      makeProfile(createRng(hashSeed(5, 'shop-1'))),
    );
  });
});

describe('decide', () => {
  it('replies about as often as the profile says, and otherwise says nothing', () => {
    const rng = createRng(3);
    const n = 5000;
    const replied = Array.from({ length: n }, () => decide(profile(), ping, rng, 1)).filter(
      (d) => d.kind === 'answer',
    ).length;
    expect(replied / n).toBeGreaterThan(0.57);
    expect(replied / n).toBeLessThan(0.63);
  });

  it('waits between 5 and 90 seconds, divided by the speed', () => {
    for (const speed of [1, 10, 1000]) {
      const rng = createRng(4);
      for (let i = 0; i < 500; i++) {
        const d = decide(profile({ replyProbability: 1 }), ping, rng, speed);
        if (d.kind !== 'answer') throw new Error('a shop with probability 1 must reply');
        expect(d.delayMs).toBeGreaterThanOrEqual(5000 / speed);
        expect(d.delayMs).toBeLessThanOrEqual(90_000 / speed);
      }
    }
  });

  it('quotes the reference price plus or minus 30 %, as whole paise in 50 paise steps', () => {
    const rng = createRng(5);
    const prices: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const d = decide(profile({ replyProbability: 1 }), ping, rng, 1);
      if (d.kind === 'answer' && d.body.answer === 'yes') prices.push(d.body.pricePaise as number);
    }
    for (const p of prices) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p % 50).toBe(0);
      expect(p).toBeGreaterThanOrEqual(5000 * 0.7 - 50);
      expect(p).toBeLessThanOrEqual(5000 * 1.3 + 50);
    }
    expect(Math.min(...prices)).toBeLessThan(5000 * 0.8); // really varies, both ways
    expect(Math.max(...prices)).toBeGreaterThan(5000 * 1.2);
  });

  it('never quotes zero or less, even for a very cheap item', () => {
    const rng = createRng(6);
    for (let i = 0; i < 500; i++) {
      const d = decide(profile({ replyProbability: 1 }), { ...ping, refPricePaise: 200 }, rng, 1);
      if (d.kind === 'answer' && d.body.pricePaise !== undefined) {
        expect(d.body.pricePaise).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it('adds a "few" or "plenty" hint to some yes answers, not all', () => {
    const rng = createRng(8);
    const yes = Array.from({ length: 2000 }, () =>
      decide(profile({ replyProbability: 1 }), ping, rng, 1),
    ).flatMap((d) => (d.kind === 'answer' && d.body.answer === 'yes' ? [d.body] : []));
    const hinted = yes.filter((b) => b.quantityHint !== undefined);
    expect(hinted.length / yes.length).toBeGreaterThan(0.25);
    expect(hinted.length / yes.length).toBeLessThan(0.55);
    for (const b of hinted) expect(['few', 'plenty']).toContain(b.quantityHint);
  });

  it('a shop that always says no answers no, with no price and no hint', () => {
    const rng = createRng(9);
    for (let i = 0; i < 200; i++) {
      const d = decide(profile({ alwaysNo: true, replyProbability: 1 }), ping, rng, 1);
      expect(d).toMatchObject({ kind: 'answer', body: { answer: 'no' } });
      if (d.kind === 'answer') expect(Object.keys(d.body)).toEqual(['answer']);
    }
  });

  it('gives the same decision for the same seed', () => {
    const run = () => {
      const rng = createRng(hashSeed(1, 's1', 'p1'));
      return decide(profile(), ping, rng, 10);
    };
    expect(run()).toEqual(run());
  });
});

describe('decide for an item with no reference price (a customer-made item, ADR-0028)', () => {
  const unknown = (category: string | null) => ({
    pingId: 'p1',
    shopId: 's1',
    refPricePaise: null,
    category,
  });
  const answers = (category: string | null, n = 4000, seed = 9) => {
    const rng = createRng(seed);
    return Array.from({ length: n }, () =>
      decide(profile({ replyProbability: 1 }), unknown(category), rng, 1),
    ).flatMap((d) => (d.kind === 'answer' ? [d.body] : []));
  };

  it('says yes about 40 % of the time and no otherwise', () => {
    const all = answers('stationery');
    const yes = all.filter((b) => b.answer === 'yes').length;
    expect(yes / all.length).toBeGreaterThan(0.36);
    expect(yes / all.length).toBeLessThan(0.44);
  });

  it('quotes a plausible price for the category, in whole rupees for dear things', () => {
    const range: Record<string, [number, number]> = {
      stationery: [1000, 30000],
      hardware: [2000, 80000],
      pooja: [1000, 50000],
      grocery: [1000, 50000],
    };
    for (const [category, [low, high]] of Object.entries(range)) {
      const prices = answers(category).flatMap((b) =>
        b.answer === 'yes' && b.pricePaise !== undefined ? [b.pricePaise] : [],
      );
      expect(prices.length, category).toBeGreaterThan(1000);
      for (const p of prices) {
        expect(p, category).toBeGreaterThanOrEqual(low);
        expect(p, category).toBeLessThanOrEqual(high);
        expect(p % 50, category).toBe(0);
      }
      // Not one fixed number: the prices spread over the range.
      expect(new Set(prices).size, category).toBeGreaterThan(20);
    }
  });

  it('uses a general range when the category is unknown or missing', () => {
    for (const category of [null, 'something_new']) {
      const prices = answers(category).flatMap((b) =>
        b.answer === 'yes' && b.pricePaise !== undefined ? [b.pricePaise] : [],
      );
      expect(prices.length).toBeGreaterThan(500);
      for (const p of prices) {
        expect(p).toBeGreaterThanOrEqual(1000);
        expect(p).toBeLessThanOrEqual(50000);
      }
    }
  });

  it('is repeatable for the same seed, and a catalog item still quotes near its reference price', () => {
    expect(answers('pooja', 50, 5)).toEqual(answers('pooja', 50, 5));
    const rng = createRng(1);
    const d = decide(
      profile({ replyProbability: 1 }),
      { refPricePaise: 5000, category: 'pooja' },
      rng,
      1,
    );
    if (d.kind === 'answer' && d.body.answer === 'yes')
      expect(d.body.pricePaise).toBeGreaterThanOrEqual(3500);
  });
});

describe('decide: a shop says yes only to items of its own categories (live: a hardware store said yes to haldi)', () => {
  const ask = (
    itemCategories: string[],
    shopCategories: string[],
    refPricePaise: number | null = 5000,
  ) => {
    const rng = createRng(11);
    return Array.from({ length: 400 }, () =>
      decide(
        profile({ replyProbability: 1 }),
        { refPricePaise, category: itemCategories[0] ?? null, itemCategories, shopCategories },
        rng,
        1,
      ),
    ).flatMap((d) => (d.kind === 'answer' ? [d.body.answer] : []));
  };

  it("a catalog item outside the shop's categories is always a no", () => {
    expect(new Set(ask(['grocery', 'general_store'], ['hardware']))).toEqual(new Set(['no']));
  });

  it('an item that shares any category with the shop can be a yes (and a no for a shop that never has anything)', () => {
    expect(ask(['grocery', 'general_store'], ['hardware', 'general_store'])).toContain('yes');
    expect(ask(['stationery'], ['stationery'], null)).toContain('yes');
    expect(new Set(ask(['stationery'], ['grocery'], null))).toEqual(new Set(['no']));
  });

  it('without category information (an older server) it behaves as before', () => {
    const rng = createRng(3);
    const d = decide(profile({ replyProbability: 1 }), { refPricePaise: 5000 }, rng, 1);
    expect(d).toMatchObject({ kind: 'answer', body: { answer: 'yes' } });
  });
});
