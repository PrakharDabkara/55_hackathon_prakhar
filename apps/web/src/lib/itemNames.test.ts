import { describe, expect, it } from 'vitest';
import { lineName } from './orders.js';
import { itemLabel } from './results.js';

// PR P: catalog item names read as sentences on the customer's screens (their own words never do).
describe('customer item names in sentence case', () => {
  const item = {
    id: 'i1',
    slug: 'maida',
    nameEn: 'refined flour',
    nameHi: 'मैदा',
    category: 'grocery',
    unverified: false,
  };

  it('itemLabel puts the first letter up in English and leaves Hindi alone', () => {
    expect(itemLabel(item, 'en')).toBe('Refined flour');
    expect(itemLabel(item, 'hi')).toBe('मैदा');
    expect(itemLabel(null, 'en')).toBeNull();
  });

  it('lineName does the same for an order line in English', () => {
    const line = { name: 'sugar (2 kg)', count: 1, pricePaise: 4500 };
    expect(lineName(line, 'en')).toBe('Sugar (2 kg)');
    // Their own word, on a Hindi screen, stays as they wrote it.
    expect(lineName({ ...line, text: 'chini' }, 'hi')).toBe('chini');
  });
});
