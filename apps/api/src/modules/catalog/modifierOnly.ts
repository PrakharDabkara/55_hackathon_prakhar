import { isTypoOf } from './editDistance.js';

const words = (text: string): string[] => text.split(' ').filter(Boolean);

/** A query word is a term word when it is the same or a few keystrokes away (short words must match). */
const sameWord = (typed: string, word: string): boolean =>
  typed === word || ([...typed].length >= 4 && [...word].length >= 4 && isTypoOf(typed, word));

/**
 * True when the query names only a modifier of a longer term of the item, and the term's last word
 * (the product) is a word that means the item by itself: "phool" for "phool jhadu" when "jhadu" is
 * the broom. The item is then a different thing than the query says ("phool" is flowers), however
 * close the letters are. A term whose last word is no product of its own ("chai patti") does not
 * count: "chai" may well mean that item. Both arguments are normalised text; `itemTerms` is every
 * term of one item (names, synonyms, defaults).
 */
export function isModifierOnlyMatch(query: string, itemTerms: string[]): boolean {
  const asked = words(query);
  if (asked.length === 0 || itemTerms.includes(query)) return false;
  const single = new Set(itemTerms.filter((t) => !t.includes(' ')));
  return itemTerms.some((term) => {
    const parts = words(term);
    if (parts.length < 2) return false;
    const head = parts[parts.length - 1] as string;
    if (!single.has(head)) return false;
    const modifiers = parts.slice(0, -1);
    return asked.every((w) => modifiers.some((m) => sameWord(w, m)));
  });
}
