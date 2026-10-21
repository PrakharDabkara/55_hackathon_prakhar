import { CATEGORIES } from '@askbuy/shared';
import { describe, expect, it } from 'vitest';
import { generateShops } from './generate.js';

const centre = { lat: 22.7196, lng: 75.8577 };
const input = { count: 200, centre, radiusM: 3000, seed: 42 };

/** Great-circle distance in metres; plenty accurate at 3 km. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

describe('generateShops', () => {
  it('is deterministic: the same seed gives the same shops, a different seed different ones', () => {
    expect(generateShops(input)).toEqual(generateShops(input));
    expect(generateShops({ ...input, seed: 43 })).not.toEqual(generateShops(input));
  });

  it('makes exactly the number asked for', () => {
    for (const count of [1, 20, 500])
      expect(generateShops({ ...input, count })).toHaveLength(count);
  });

  it('puts every shop inside the radius', () => {
    for (const s of generateShops(input)) {
      expect(metres(centre, s)).toBeLessThanOrEqual(input.radiusM + 1);
    }
  });

  it('spreads shops over the area, not in one clump', () => {
    const far = generateShops(input).filter((s) => metres(centre, s) > input.radiusM / 2);
    expect(far.length).toBeGreaterThan(input.count / 2); // a disc has 75% of its area beyond half the radius
  });

  it('gives each shop one or two distinct valid categories', () => {
    for (const s of generateShops(input)) {
      expect(s.categories.length).toBeGreaterThanOrEqual(1);
      expect(s.categories.length).toBeLessThanOrEqual(2);
      expect(new Set(s.categories).size).toBe(s.categories.length);
      for (const c of s.categories) expect(CATEGORIES).toContain(c);
    }
  });

  it('mixes all 13 categories, with groceries the most common (as on a real street)', () => {
    const shops = generateShops({ ...input, count: 500 });
    const primary = new Map<string, number>();
    for (const s of shops)
      primary.set(s.categories[0] as string, (primary.get(s.categories[0] as string) ?? 0) + 1);
    expect([...primary.keys()].sort()).toEqual([...CATEGORIES].sort());
    const top = [...primary.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(top?.[0]).toBe('grocery');
  });

  it('has enough stationery, hardware and pooja shops for the school-project demo', () => {
    const shops = generateShops({ ...input, count: 200 });
    const first = (c: string) => shops.filter((s) => s.categories[0] === c);
    expect(first('stationery').length).toBeGreaterThanOrEqual(12);
    expect(first('hardware').length).toBeGreaterThanOrEqual(12);
    expect(first('pooja').length).toBeGreaterThanOrEqual(4);
    expect(first('stationery').some((s) => /Stationer|Book|Stationery/i.test(s.name))).toBe(true);
    expect(first('pooja').some((s) => /Pooja|Puja|Bhandar|Samagri/i.test(s.name))).toBe(true);
    expect(first('dairy').some((s) => /Dairy|Doodh|Milk/i.test(s.name))).toBe(true);
  });

  it('gives Indian-style shop names that fit the first category', () => {
    const shops = generateShops({ ...input, count: 500 });
    for (const s of shops) {
      expect(s.name.length).toBeGreaterThan(5);
      expect(s.name.length).toBeLessThanOrEqual(80);
      expect(s.name).toMatch(/^[A-Za-z][A-Za-z &'.-]+$/);
    }
    const grocery = shops.filter((s) => s.categories[0] === 'grocery').map((s) => s.name);
    expect(grocery.some((n) => /Kirana|General|Provision|Stores?|Mart|Bhandar/i.test(n))).toBe(
      true,
    );
    const hardware = shops.filter((s) => s.categories[0] === 'hardware').map((s) => s.name);
    expect(hardware.some((n) => /Hardware|Paints|Tools/i.test(n))).toBe(true);
    expect(new Set(shops.map((s) => s.name)).size).toBeGreaterThan(100); // varied, not one name 500 times
  });

  it('gives every shop a unique name: two shops never share one (live showed twins at different distances)', () => {
    for (const [count, seed] of [
      [500, 42],
      [500, 7],
      [200, 1],
    ] as const) {
      const names = generateShops({ ...input, count, seed }).map((s) => s.name);
      expect(new Set(names).size, `${count}/${seed}`).toBe(count);
      for (const name of names) {
        expect(name.length).toBeLessThanOrEqual(80);
        expect(name).toMatch(/^[A-Za-z][A-Za-z0-9 &'.-]+$/);
      }
    }
  });

  it('keeps a name as it was when it is already unique, and adds a locality (then a number) only to repeats', () => {
    const names = generateShops({ ...input, count: 500, seed: 42 }).map((s) => s.name);
    expect(names.filter((n) => / - /.test(n)).length).toBeGreaterThan(0);
    expect(names.filter((n) => !/ - /.test(n)).length).toBeGreaterThan(100);
  });

  it('gives each shop a unique valid phone in a reserved block, so no real user is hit', () => {
    const shops = generateShops({ ...input, count: 500 });
    const phones = shops.map((s) => s.phone);
    expect(new Set(phones).size).toBe(500);
    for (const p of phones) expect(p).toMatch(/^\+9160\d{8}$/);
  });

  describe('with a category filter', () => {
    it('makes only shops of those categories (one category each when only one is allowed)', () => {
      const grocery = generateShops({ ...input, count: 100, categories: ['grocery'] });
      for (const s of grocery) expect(s.categories).toEqual(['grocery']);
      const two = generateShops({ ...input, count: 200, categories: ['hardware', 'electrical'] });
      for (const s of two) {
        for (const c of s.categories) expect(['hardware', 'electrical']).toContain(c);
      }
      expect(new Set(two.map((s) => s.categories[0]))).toEqual(new Set(['hardware', 'electrical']));
    });

    it('is still deterministic, and names fit the category', () => {
      const a = generateShops({ ...input, count: 30, categories: ['grocery'] });
      expect(a).toEqual(generateShops({ ...input, count: 30, categories: ['grocery'] }));
      expect(
        a.every((s) => /Kirana|General|Provision|Stores?|Mart|Bhandar|Dairy/i.test(s.name)),
      ).toBe(true);
    });
  });

  describe('the mix for live use: 200 shops spread over 3 km (the demo centre, a customer at the middle)', () => {
    const near = (s: { lat: number; lng: number }) =>
      Math.hypot(
        (s.lat - centre.lat) * 111_000,
        (s.lng - centre.lng) * 111_000 * Math.cos((centre.lat * Math.PI) / 180),
      ) <= 2000;
    // Shops of a kind inside 2 km of the middle, for ten different seeds.
    const counts = (category: string) =>
      Array.from(
        { length: 10 },
        (_, i) =>
          generateShops({ count: 200, centre, radiusM: 3000, seed: i + 1 }).filter(
            (s) => near(s) && s.categories.includes(category as never),
          ).length,
      );
    const fewest = (category: string) => Math.min(...counts(category));
    const average = (category: string) => counts(category).reduce((a, b) => a + b, 0) / 10;

    it('has plenty of the common kinds near, on every seed: grocery, stationery, dairy', () => {
      expect(fewest('grocery')).toBeGreaterThanOrEqual(12);
      expect(fewest('stationery')).toBeGreaterThanOrEqual(5);
      expect(fewest('dairy')).toBeGreaterThanOrEqual(3);
    });

    it('has a fair share of every other kind near (on average, so one lucky or unlucky street does not decide)', () => {
      for (const c of [
        'general_store',
        'hardware',
        'electrical',
        'household_kitchen',
        'personal_care',
        'mobile_accessories',
      ])
        expect(average(c), c).toBeGreaterThanOrEqual(6);
      for (const c of ['sabzi_fruit', 'pooja', 'medical', 'bakery_sweets'])
        expect(average(c), c).toBeGreaterThanOrEqual(4);
    });

    it('counts each kind close to its share of the deck, whatever the seed (a street is never without dairy)', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const shops = generateShops({ count: 200, centre, radiusM: 3000, seed });
        for (const c of ['dairy', 'pooja', 'medical', 'bakery_sweets'])
          expect(
            shops.filter((s) => s.categories[0] === c).length,
            `${c}/${seed}`,
          ).toBeGreaterThanOrEqual(10);
      }
    });
  });
});
