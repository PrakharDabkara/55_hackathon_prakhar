import { describe, expect, it } from 'vitest';
import { isExpectedMatch } from './matchedAs.js';

const candle = ['candle', 'मोमबत्ती', 'mombatti', 'mom batti', 'white candle', 'candles'];
const teaLeaves = ['tea leaves', 'चायपत्ती', 'chai patti', 'chaipatti', 'tea powder'];

describe('isExpectedMatch', () => {
  it('is expected when the words are a name or synonym of the item', () => {
    expect(isExpectedMatch('mombatti', candle)).toBe(true);
    expect(isExpectedMatch('Chai Patti', teaLeaves)).toBe(true);
    expect(isExpectedMatch('चायपत्ती', teaLeaves)).toBe(true);
  });

  it('ignores a quantity in the words', () => {
    expect(isExpectedMatch('chai patti 250 gram', teaLeaves)).toBe(true);
  });

  it('is expected for a typo of a term', () => {
    expect(isExpectedMatch('chai pati', teaLeaves)).toBe(true);
    expect(isExpectedMatch('mombati', candle)).toBe(true);
  });

  it('is expected when the words are part of a term, or a term is part of the words', () => {
    expect(isExpectedMatch('chai', teaLeaves)).toBe(true);
    expect(isExpectedMatch('red candle', candle)).toBe(true);
  });

  it('is not expected when the item is a different thing: diya answered by a candle', () => {
    expect(isExpectedMatch('diya', candle)).toBe(false);
    expect(isExpectedMatch('दीया', candle)).toBe(false);
  });
});
