import { describe, expect, it } from 'vitest';
import seed from './catalog.seed.json' with { type: 'json' };
import { termsFor } from './seedData.js';
import { formConflict, formsOf, PRODUCT_FORMS } from './productForm.js';

describe('formsOf', () => {
  it('finds the product-form words in a normalised query, in Latin and Devanagari', () => {
    expect([...formsOf('chandan itr')]).toEqual(['attar']);
    expect([...formsOf('sarson ka tel')]).toEqual(['oil']);
    expect([...formsOf('haldi powder')]).toEqual(['powder']);
    expect([...formsOf('लक्स साबुन')]).toEqual(['soap']);
    expect([...formsOf('aam achaar')]).toEqual(['pickle']);
    expect([...formsOf('mogra agarbatti')]).toEqual(['incense']);
    expect([...formsOf('chandan')]).toEqual([]);
  });

  it('matches whole words only', () => {
    expect([...formsOf('toilet cleaner')]).toEqual([]);
    expect([...formsOf('powdered sugar')]).toEqual([]);
  });

  it('is a short, curated list', () => {
    expect(Object.keys(PRODUCT_FORMS).length).toBeLessThanOrEqual(10);
  });
});

describe('formConflict', () => {
  it('says itr is not powder, tel is not powder, sabun is not oil', () => {
    expect(formConflict('chandan itr', ['sandalwood powder', 'चंदन'])).toBe(true);
    expect(formConflict('sarson tel', ['turmeric powder'])).toBe(true);
    expect(formConflict('nariyal sabun', ['coconut oil'])).toBe(true);
  });

  it('allows the same form in another language or spelling', () => {
    expect(formConflict('sarson ka tel', ['mustard oil'])).toBe(false);
    expect(formConflict('haldi powder', ['turmeric powder', 'हल्दी पाउडर'])).toBe(false);
    expect(formConflict('gulab ittar', ['rose attar'])).toBe(false);
  });

  it('has no opinion when the query names no form, or the item has none', () => {
    expect(formConflict('chandan', ['sandalwood powder'])).toBe(false);
    expect(formConflict('chandan itr', ['sandalwood'])).toBe(false);
  });

  it('does not reject any item for its own catalog terms', () => {
    for (const item of seed.items) {
      const names = [item.nameEn, item.nameHi];
      for (const term of termsFor(item as never)) {
        expect(formConflict(term, names), `${term} → ${item.nameEn}`).toBe(false);
      }
    }
  });
});
