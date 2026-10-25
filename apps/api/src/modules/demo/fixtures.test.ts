import { CATEGORIES, DEMO_PLACE as SHARED_DEMO_PLACE } from '@askbuy/shared';
import { describe, expect, it } from 'vitest';
import catalog from '../catalog/catalog.seed.json' with { type: 'json' };
import {
  DEMO_CUSTOMER_PHONES,
  DEMO_PLACE,
  DEMO_SHOPS,
  DEMO_SIMULATED_SHOPS,
  DEMO_STOCK,
  DEMO_STOCK_NOTE,
  isDemoPhone,
} from './fixtures.js';

/** Straight-line metres between two points (haversine). */
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

describe('demo fixtures (ADR-0062)', () => {
  it('has five shops on 9000000102 to 9000000106, open, with one to three real categories', () => {
    expect(DEMO_SHOPS.map((s) => s.phone)).toEqual([
      '+919000000102',
      '+919000000103',
      '+919000000104',
      '+919000000105',
      '+919000000106',
    ]);
    for (const shop of DEMO_SHOPS) {
      expect(shop.categories.length).toBeGreaterThanOrEqual(1);
      expect(shop.categories.length).toBeLessThanOrEqual(3);
      for (const c of shop.categories) expect(CATEGORIES).toContain(c);
      expect(shop.name.length).toBeGreaterThan(5);
    }
  });

  it('puts every pair of shops 300 m to 1.5 km apart, near the Vijay Nagar demo place', () => {
    for (const a of DEMO_SHOPS) {
      expect(metres(a, DEMO_PLACE)).toBeLessThan(1500);
      for (const b of DEMO_SHOPS) {
        if (a === b) continue;
        const d = metres(a, b);
        expect(d).toBeGreaterThanOrEqual(300);
        expect(d).toBeLessThanOrEqual(1500);
      }
    }
  });

  it('keeps every seeded and simulated demo shop within 2 km of the demo place (X-03)', () => {
    for (const shop of DEMO_SHOPS) expect(metres(shop, DEMO_PLACE)).toBeLessThanOrEqual(2000);
    expect(DEMO_SIMULATED_SHOPS.radiusM).toBeLessThanOrEqual(2000);
  });

  it('has two shops that deliver (₹20 and ₹30) and three that are pickup only', () => {
    const fees = DEMO_SHOPS.filter((s) => s.delivery).map((s) => s.delivery?.feePaise);
    expect(fees.sort()).toEqual([2000, 3000]);
    expect(DEMO_SHOPS.filter((s) => !s.delivery)).toHaveLength(3);
  });

  it('has customers 9000000202 to 9000000206 and knows the demo numbers 101-110 and 201-210', () => {
    expect(DEMO_CUSTOMER_PHONES).toEqual([
      '+919000000202',
      '+919000000203',
      '+919000000204',
      '+919000000205',
      '+919000000206',
    ]);
    for (let n = 101; n <= 110; n++) expect(isDemoPhone(`+919000000${n}`)).toBe(true);
    for (let n = 201; n <= 210; n++) expect(isDemoPhone(`+919000000${n}`)).toBe(true);
    for (const p of ['+919000000100', '+919000000111', '+919000000200', '+919000000211'])
      expect(isDemoPhone(p)).toBe(false);
    expect(isDemoPhone('+919876543210')).toBe(false);
  });

  it('wants about eight simulated shops around the demo place', () => {
    expect(DEMO_SIMULATED_SHOPS.count).toBe(8);
    expect(DEMO_SIMULATED_SHOPS.radiusM).toBeLessThanOrEqual(1500);
  });

  it('is marked illustrative and prices about 40 catalog items in plausible 2026 rupees', () => {
    expect(DEMO_STOCK_NOTE.toLowerCase()).toContain('illustrative');
    const slugs = new Set(catalog.items.map((i) => i.slug));
    const refs = new Map(catalog.items.map((i) => [i.slug, i.refPricePaise]));
    const distinct = new Set<string>();
    for (const row of DEMO_STOCK) {
      expect(slugs.has(row.slug), `${row.slug} is not in the catalog`).toBe(true);
      expect(DEMO_SHOPS[row.shop]).toBeDefined();
      expect(Number.isInteger(row.pricePaise) && row.pricePaise > 0).toBe(true);
      // Within a factor of two of the catalog's own shelf price.
      const ref = refs.get(row.slug) as number;
      expect(row.pricePaise).toBeGreaterThanOrEqual(ref * 0.5);
      expect(row.pricePaise).toBeLessThanOrEqual(ref * 1.6);
      distinct.add(row.slug);
    }
    expect(distinct.size).toBeGreaterThanOrEqual(36);
    expect(distinct.size).toBeLessThanOrEqual(46);
  });

  it('stocks each shop only with items of its own kinds, and never twice', () => {
    const catOf = new Map(catalog.items.map((i) => [i.slug, i.category]));
    const seen = new Set<string>();
    for (const row of DEMO_STOCK) {
      const shop = DEMO_SHOPS[row.shop];
      expect(shop?.categories).toContain(catOf.get(row.slug));
      const key = `${row.shop}:${row.slug}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    for (const [i] of DEMO_SHOPS.entries())
      expect(DEMO_STOCK.filter((r) => r.shop === i).length).toBeGreaterThanOrEqual(6);
  });
});

describe('the demo place has one source', () => {
  it('is the shared one the web app also uses (X-01)', () => {
    expect(DEMO_PLACE).toBe(SHARED_DEMO_PLACE);
  });
});
