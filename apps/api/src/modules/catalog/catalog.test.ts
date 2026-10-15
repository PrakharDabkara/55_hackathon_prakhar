import { CATEGORIES } from '@kahanmilega/shared';
import { describe, expect, it } from 'vitest';
import seed from './catalog.seed.json' with { type: 'json' };
import { REMOVED_TERMS } from '../../testing/removedTerms.js';
import { normaliseQuery } from './normalise.js';
import { checkCatalog, parseCatalog, termsFor } from './seedData.js';

const catalog = parseCatalog(seed);

describe('seed catalog file', () => {
  it('declares a version and says the synonyms were AI-generated and reviewed', () => {
    expect(catalog.version).toBeGreaterThanOrEqual(1);
    expect(catalog.note).toMatch(/AI-generated/i);
    expect(catalog.note).toMatch(/review/i);
  });

  it('has about 150 items or more, spread over all 8 categories', () => {
    expect(catalog.items.length).toBeGreaterThanOrEqual(140);
    const used = new Set(catalog.items.map((i) => i.category));
    expect([...used].sort()).toEqual([...CATEGORIES].sort());
  });

  it('gives every item a Devanagari name and 3–6 synonyms', () => {
    for (const item of catalog.items) {
      expect(item.nameHi, item.slug).toMatch(/[ऀ-ॿ]/);
      expect(item.synonyms.length, item.slug).toBeGreaterThanOrEqual(3);
      expect(item.synonyms.length, item.slug).toBeLessThanOrEqual(6);
    }
  });

  it('passes the consistency check: unique slugs, no term shared between items', () => {
    expect(() => checkCatalog(catalog)).not.toThrow();
  });

  it('does not contain any term that was removed as ambiguous', () => {
    const all = new Set(catalog.items.flatMap(termsFor));
    for (const term of REMOVED_TERMS) {
      expect(all.has(normaliseQuery(term).text), term).toBe(false);
    }
  });

  it('has specific forms for the removed generic words', () => {
    const owner = (query: string) =>
      catalog.items.find((i) => termsFor(i).includes(normaliseQuery(query).text))?.slug;
    expect(owner('paper clip')).toBe('paper-clips');
    expect(owner('nail cutter')).toBe('nail-cutter');
    expect(owner('नेल कटर')).toBe('nail-cutter');
    expect(owner('clothes clips')).toBe('clothes-clips');
    expect(owner('electric switch')).toBe('electric-switch');
    expect(owner('safety pin')).toBe('safety-pins');
  });

  it('covers English, Devanagari and Hinglish spellings for the same item', () => {
    const owner = (query: string) => {
      const text = normaliseQuery(query).text;
      return catalog.items.find((i) => termsFor(i).includes(text))?.slug;
    };
    expect(owner('aata')).toBe('wheat-flour');
    expect(owner('आटा')).toBe('wheat-flour');
    expect(owner('gehun ka atta')).toBe('wheat-flour');
    expect(owner('bottle cleaning brush')).toBe('bottle-brush');
    expect(owner('bottel brush')).toBe('bottle-brush');
    expect(owner('झाड़ू')).toBe('broom');
  });
});

const item = (slug: string, synonyms: string[], nameEn = slug, nameHi = `नाम ${slug}`) => ({
  slug,
  category: 'grocery' as const,
  nameEn,
  nameHi,
  synonyms,
});

const file = (...items: ReturnType<typeof item>[]) => ({ version: 1, note: 'x', items });

describe('termsFor', () => {
  it('normalises names and synonyms and drops duplicates within the item', () => {
    const terms = termsFor(
      item('item-a', ['Gehun ka Atta', 'gehun atta', 'AATA!'], 'Wheat Flour', 'आटा'),
    );
    expect(terms).toEqual(['wheat flour', 'आटा', 'gehun atta', 'aata']);
  });
});

describe('checkCatalog', () => {
  it('rejects a term claimed by two items', () => {
    const bad = file(
      item('item-a', ['x1', 'shared', 'x2']),
      item('item-b', ['shared', 'y1', 'y2']),
    );
    expect(() => checkCatalog(bad)).toThrowError(/shared/);
  });

  it('rejects duplicate slugs', () => {
    const bad = file(item('item-a', ['x1', 'x2', 'x3']), item('item-a', ['y1', 'y2', 'y3']));
    expect(() => checkCatalog(bad)).toThrowError(/slug/);
  });

  it('rejects a term that normalises to nothing or to a quantity', () => {
    expect(() => checkCatalog(file(item('item-a', ['please', 'x2', 'x3'])))).toThrowError(/please/);
    expect(() => checkCatalog(file(item('item-a', ['5 kg atta', 'x2', 'x3'])))).toThrowError(
      /5 kg atta/,
    );
  });
});

describe('reference prices', () => {
  it('says the prices are AI-estimated', () => {
    expect(catalog.note).toMatch(/AI-estimated/i);
    expect(catalog.note).toMatch(/refPricePaise|reference price/i);
  });

  it('gives every item a whole-number price in paise between ₹1 and ₹50,000', () => {
    for (const item of catalog.items) {
      expect(Number.isInteger(item.refPricePaise), item.slug).toBe(true);
      expect(item.refPricePaise, item.slug).toBeGreaterThanOrEqual(100);
      expect(item.refPricePaise, item.slug).toBeLessThanOrEqual(5_000_000);
    }
  });

  it('is realistic for a few items anyone can sanity-check', () => {
    const price = (slug: string) => catalog.items.find((i) => i.slug === slug)?.refPricePaise;
    expect(price('matchbox')).toBeLessThanOrEqual(500);
    expect(price('milk')).toBeGreaterThanOrEqual(2500);
    expect(price('milk')).toBeLessThanOrEqual(8000);
    expect(price('ceiling-fan')).toBeGreaterThan(price('table-fan') as number);
    expect(price('basmati-rice')).toBeGreaterThan(price('rice') as number);
    expect(price('drill-machine')).toBeGreaterThan(price('hammer') as number);
  });
});
