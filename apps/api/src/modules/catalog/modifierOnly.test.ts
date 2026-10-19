import { describe, expect, it } from 'vitest';
import { isModifierOnlyMatch } from './modifierOnly.js';

const broom = ['broom', 'झाड़ू', 'jhadu', 'jhaadu', 'jhadoo', 'phool jhadu', 'safai jhadu'];

describe('isModifierOnlyMatch: a query that names only a modifier of a longer term', () => {
  it('rejects "phool" for the broom: the unmatched word of "phool jhadu" is the product', () => {
    expect(isModifierOnlyMatch('phool', broom)).toBe(true);
    expect(isModifierOnlyMatch('safai', broom)).toBe(true);
  });

  it('keeps the whole term, the product word and anything that is itself a term', () => {
    expect(isModifierOnlyMatch('phool jhadu', broom)).toBe(false);
    expect(isModifierOnlyMatch('jhadu', broom)).toBe(false);
    expect(isModifierOnlyMatch('broom', broom)).toBe(false);
  });

  it('allows a modifier when the last word is no product of its own ("chai" for chai patti)', () => {
    expect(isModifierOnlyMatch('chai', ['tea leaves', 'chai patti', 'chaipatti'])).toBe(false);
    expect(isModifierOnlyMatch('toilet', ['toilet cleaner', 'harpic'])).toBe(false);
  });

  it('allows a query that also names the product word, or a form word is all that is left', () => {
    expect(isModifierOnlyMatch('lal mirch', ['lal mirch powder', 'mirchi powder'])).toBe(false);
    expect(isModifierOnlyMatch('safai jhadu', broom)).toBe(false);
  });

  it('counts a small typo in the modifier as the modifier', () => {
    expect(isModifierOnlyMatch('phol', broom)).toBe(true);
    expect(isModifierOnlyMatch('phool', ['phool jhadu', 'jhadu'])).toBe(true);
    expect(isModifierOnlyMatch('phoool', ['phool jhadu', 'jhadu'])).toBe(true);
  });

  it('has no opinion on a query with words the item never mentions', () => {
    expect(isModifierOnlyMatch('naya jhadu', broom)).toBe(false);
  });
});
