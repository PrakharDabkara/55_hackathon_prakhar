import { describe, expect, it } from 'vitest';
import { catalogVersionOf, checkCatalog, loadSeedCatalog, parseCatalog } from './seedData.js';

const item = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  category: 'stationery',
  nameEn: `${slug} one`,
  nameHi: `${slug} हिंदी`,
  refPricePaise: 1000,
  synonyms: [`${slug} a`, `${slug} b`, `${slug} c`],
  ...extra,
});
const catalog = (...items: ReturnType<typeof item>[]) =>
  parseCatalog({ version: 1, note: 'n', items });

describe('defaultFor: generic words that mean one usual item', () => {
  it('is optional and accepted on an item', () => {
    expect(() => catalog(item('ball-pen', { defaultFor: ['pen'] }), item('rice'))).not.toThrow();
  });

  it('may not repeat a term that is already a name or synonym', () => {
    const c = catalog(item('ball-pen', { defaultFor: ['gel-pen a'] }), item('gel-pen'));
    expect(() => checkCatalog(c)).toThrow(/gel-pen a/);
  });

  it('may be claimed by only one item', () => {
    const c = catalog(
      item('ball-pen', { defaultFor: ['pen'] }),
      item('gel-pen', { defaultFor: ['pen'] }),
    );
    expect(() => checkCatalog(c)).toThrow(/pen/);
  });

  it('ships in the seed for the families we chose', () => {
    const seed = loadSeedCatalog();
    const defaults = new Map(seed.items.map((i) => [i.slug, i.defaultFor ?? []]));
    expect(defaults.get('ball-pen')).toContain('pen');
    expect(defaults.get('water-bottle')).toContain('bottle');
    expect(() => checkCatalog(seed)).not.toThrow();
  });

  it('leaves the genuinely different things alone', () => {
    const all = loadSeedCatalog().items.flatMap((i) => i.defaultFor ?? []);
    for (const word of ['clip', 'oil', 'battery', 'dal', 'tape', 'brush', 'plug', 'paper', 'pin'])
      expect(all, word).not.toContain(word);
  });
});

describe('catalogVersionOf', () => {
  it('is the same for the same file and changes when anything in it changes', () => {
    const a = { version: 1, items: [{ slug: 'x' }] };
    expect(catalogVersionOf(a)).toBe(catalogVersionOf(structuredClone(a)));
    expect(catalogVersionOf(a)).not.toBe(catalogVersionOf({ ...a, items: [{ slug: 'y' }] }));
    expect(catalogVersionOf(a)).toMatch(/^[0-9a-f]{16}$/);
  });
});
