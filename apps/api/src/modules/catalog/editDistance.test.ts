import { describe, expect, it } from 'vitest';
import { editDistance, isTypoOf } from './editDistance.js';

describe('editDistance (Damerau-Levenshtein: a swap of two neighbours counts once)', () => {
  it('counts insertions, deletions, substitutions and swaps', () => {
    expect(editDistance('pencil', 'pencil')).toBe(0);
    expect(editDistance('puncil', 'pencil')).toBe(1);
    expect(editDistance('hammmer', 'hammer')).toBe(1);
    expect(editDistance('hamer', 'hammer')).toBe(1);
    expect(editDistance('teh', 'the')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('isTypoOf: at most a third of the word length in edits', () => {
  it.each([
    ['puncil', 'pencil'],
    ['stepler', 'stapler'],
    ['hammmer', 'hammer'],
    ['screwdrivar', 'screwdriver'],
    ['shampu', 'shampoo'],
  ])('%s is a typo of %s', (typed, word) => {
    expect(isTypoOf(typed, word)).toBe(true);
  });

  it.each([
    ['guitar', 'glitter'],
    ['xyzzy', 'plug'],
    ['asdf', 'sand'],
  ])('%s is not a typo of %s', (typed, word) => {
    expect(isTypoOf(typed, word)).toBe(false);
  });
});
