import { isTypoOf, normaliseQuery } from '../catalog/index.js';

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * Is the item a customer got what they would expect from the words they used? True when the words
 * are one of the item's names or synonyms, a typo of one, or share all their words with one
 * ("chai" for "chai patti", "red candle" for "candle"). False when the match is a leap the
 * customer may not expect: "diya" answered by a candle. `terms` are the item's normalised words.
 */
export function isExpectedMatch(said: string, terms: readonly string[]): boolean {
  const text = normaliseQuery(said).text;
  if (!text) return true;
  const mine = wordsOf(text);
  return terms.some((term) => {
    if (term === text) return true;
    const theirs = wordsOf(term);
    const within = (small: string[], big: string[]) => small.every((w) => big.includes(w));
    if (within(mine, theirs) || within(theirs, mine)) return true;
    return isTypoOf(text, term);
  });
}
