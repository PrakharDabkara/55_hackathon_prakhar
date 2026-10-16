export type Unit = 'kg' | 'g' | 'l' | 'ml' | 'pc';

export interface Quantity {
  quantity: number;
  unit: Unit;
}

export interface NormalisedQuery {
  text: string;
  quantity?: Quantity;
}

/** Words that carry no item meaning in a request. Whole words only. */
const FILLER = new Set([
  'ka',
  'ki',
  'ke',
  'ko',
  'chahiye',
  'chahie',
  'chaiye',
  'need',
  'needed',
  'want',
  'please',
  'plz',
  'pls',
  'a',
  'an',
  'the',
  'of',
  'for',
  'mujhe',
  'का',
  'की',
  'के',
  'को',
  'चाहिए',
  'मुझे',
]);

const UNITS: Record<string, Unit> = {
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  किलो: 'kg',
  g: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  ग्राम: 'g',
  l: 'l',
  ltr: 'l',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  लीटर: 'l',
  ml: 'ml',
  pc: 'pc',
  pcs: 'pc',
  piece: 'pc',
  pieces: 'pc',
  नग: 'pc',
};

const NUMBER = /^\d+(?:\.\d+)?$/;
const NUMBER_WITH_UNIT = /^(\d+(?:\.\d+)?)(\p{L}[\p{L}\p{M}]*)$/u;

/** Letters, combining marks (Devanagari vowel signs) and digits survive; "." stays for decimals. */
const NOT_WORD = /[^\p{L}\p{M}\p{N}.]+/gu;

/**
 * Turns a raw user query into the text we look up, plus a quantity if one was typed
 * ("5 kg", "5kg", "2 litre"). Hindi, Hinglish and English are all handled here, with no AI.
 */
export function normaliseQuery(raw: string): NormalisedQuery {
  const words = raw
    .normalize('NFC')
    .toLowerCase()
    .replace(NOT_WORD, ' ')
    .split(' ')
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);

  let quantity: Quantity | undefined;
  const kept: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (FILLER.has(word)) continue;

    if (!quantity) {
      // "5kg" in one word.
      const joined = NUMBER_WITH_UNIT.exec(word);
      const joinedUnit = joined?.[2] ? UNITS[joined[2]] : undefined;
      if (joined?.[1] && joinedUnit) {
        quantity = { quantity: Number(joined[1]), unit: joinedUnit };
        continue;
      }
      // "5 kg" as two words.
      const next = words[i + 1];
      const nextUnit = next ? UNITS[next] : undefined;
      if (NUMBER.test(word) && nextUnit) {
        quantity = { quantity: Number(word), unit: nextUnit };
        i++;
        continue;
      }
    }
    kept.push(word);
  }

  const text = kept.join(' ');
  return quantity ? { text, quantity } : { text };
}

const MAX_QUERY_CHARS = 100;

/**
 * The app's search box is one line, so a query with line breaks is not from the app: keep the first
 * non-empty line and drop the rest (text hidden after a blank line cannot reach any step). Also
 * cuts very long input to 100 characters.
 */
export function firstLine(raw: string): string {
  const line = raw.split(/\r?\n|\u2028|\u2029/).find((l) => l.trim() !== '') ?? '';
  return [...line.trim()].slice(0, MAX_QUERY_CHARS).join('');
}
