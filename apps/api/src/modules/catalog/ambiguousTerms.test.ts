import { describe, expect, it } from 'vitest';
import { loadSeedCatalog } from './seed.js';
import { ambiguousTerms, checkCatalog, parseCatalog } from './seedData.js';

const item = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  category: 'grocery',
  nameEn: `${slug} one`,
  nameHi: `${slug} हिंदी`,
  refPricePaise: 1000,
  synonyms: [`${slug} a`, `${slug} b`, `${slug} c`],
  ...extra,
});
const catalog = (ambiguous: unknown, ...items: ReturnType<typeof item>[]) =>
  parseCatalog({ version: 1, note: 'n', items, ambiguous });
const entry = (over: Record<string, unknown> = {}) => ({
  terms: ['mirchi'],
  items: ['red', 'green'],
  question: 'Kaunsi mirch?',
  ...over,
});

describe('ambiguous: everyday words that mean several items (PR H)', () => {
  it('is optional and lists the words, the items to choose from and the question', () => {
    expect(() => catalog(undefined, item('red'), item('green'))).not.toThrow();
    const ok = catalog([entry()], item('red'), item('green'));
    expect(() => checkCatalog(ok)).not.toThrow();
    expect(ambiguousTerms(ok).get('mirchi')).toEqual({
      question: 'Kaunsi mirch?',
      slugs: ['red', 'green'],
    });
  });

  it('needs at least two items to choose between', () => {
    expect(() => catalog([entry({ items: ['red'] })], item('red'))).toThrow();
  });

  it('rejects an item that is not in the catalog', () => {
    const bad = catalog([entry({ items: ['red', 'purple'] })], item('red'), item('green'));
    expect(() => checkCatalog(bad)).toThrow(/purple/);
  });

  it('rejects a word that is already a name, a synonym or a default: it would not be ambiguous', () => {
    const bad = catalog([entry({ terms: ['red a'] })], item('red'), item('green'));
    expect(() => checkCatalog(bad)).toThrow(/red a/);
    const dflt = catalog(
      [entry({ terms: ['chilli'] })],
      item('red', { defaultFor: ['chilli'] }),
      item('green'),
    );
    expect(() => checkCatalog(dflt)).toThrow(/chilli/);
  });

  it('rejects a word listed twice', () => {
    const bad = catalog([entry(), entry({ items: ['green', 'red'] })], item('red'), item('green'));
    expect(() => checkCatalog(bad)).toThrow(/mirchi/);
  });

  it('normalises the words, so Devanagari and spelling variants are found', () => {
    const c = catalog([entry({ terms: ['Mirchi!', 'मिर्च'] })], item('red'), item('green'));
    expect([...ambiguousTerms(c).keys()]).toEqual(['mirchi', 'मिर्च']);
  });

  it('ships in the seed for mirchi, daal and tel, in Latin and Devanagari', () => {
    const seed = loadSeedCatalog();
    checkCatalog(seed);
    const words = ambiguousTerms(seed);
    for (const w of ['mirchi', 'mirch', 'मिर्च', 'daal', 'dal', 'दाल', 'tel', 'oil', 'तेल'])
      expect(words.has(w), w).toBe(true);
    expect(words.get('mirchi')?.slugs).toEqual(
      expect.arrayContaining(['red-chilli-powder', 'green-chilli', 'black-pepper']),
    );
    expect(words.get('daal')?.slugs).toEqual(
      expect.arrayContaining(['toor-dal', 'moong-dal', 'chana-dal', 'urad-dal']),
    );
    expect(words.get('tel')?.slugs).toEqual(
      expect.arrayContaining(['refined-oil', 'mustard-oil', 'hair-oil']),
    );
  });
});
