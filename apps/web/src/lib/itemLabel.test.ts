import { describe, expect, it } from 'vitest';
import { itemWords } from './itemLabel.js';

describe('itemWords: the Hindi name over the English one, and never the same name twice', () => {
  it('puts a Devanagari name first with the English under it', () => {
    expect(itemWords({ nameEn: 'cumin', nameHi: 'जीरा' })).toEqual({ main: 'जीरा', sub: 'cumin' });
  });

  it('shows a customer-made item once: its Hindi name is its English one', () => {
    expect(itemWords({ nameEn: 'Kesar', nameHi: 'Kesar' })).toEqual({ main: 'Kesar' });
    expect(itemWords({ nameEn: 'saffron pouch', nameHi: 'Saffron Pouch' })).toEqual({
      main: 'saffron pouch',
    });
  });

  it('uses the English name when there is no Devanagari name at all', () => {
    expect(itemWords({ nameEn: 'Kesar', nameHi: '' })).toEqual({ main: 'Kesar' });
    expect(itemWords({ nameEn: 'Kesar', nameHi: 'केसर Kesar' })).toEqual({
      main: 'केसर Kesar',
      sub: 'Kesar',
    });
  });
});
