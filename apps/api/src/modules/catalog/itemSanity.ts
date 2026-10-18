/**
 * Code-level checks before a new item is made (ADR-0028, "when unsure, do not create"). They run
 * before the model and cost nothing. They are deliberately conservative: text they refuse stays
 * "not found" and the customer is asked to say more; they never block an accessory for a big item
 * ("iphone charger", "car freshener"). The model decides what code cannot (a person, a feeling).
 */
export type Sanity =
  { ok: true } | { ok: false; reason: 'not_words' | 'sentence' | 'out_of_scope' };

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const keyboardRun = (word: string): boolean =>
  ROWS.some((row) => {
    const back = [...row].reverse().join('');
    for (let i = 0; i + 4 <= word.length; i++) {
      const piece = word.slice(i, i + 4);
      if (row.includes(piece) || back.includes(piece)) return true;
    }
    return false;
  });

const LATIN = /^[a-z0-9]+$/;
const DEVANAGARI = /^[ऀ-ॿ]+$/;

/** A token that looks like a word of some language: a vowel, no mash, no long repeats. */
function wordLike(token: string): boolean {
  if (DEVANAGARI.test(token)) return [...token].length >= 2 && [...token].length <= 24;
  if (!LATIN.test(token) || /\d/.test(token) || token.length < 3) return false;
  if (!/[aeiouy]/.test(token)) return false;
  if (/(.)\1\1/.test(token)) return false;
  if (/[^aeiouy]{5,}/.test(token)) return false;
  if (keyboardRun(token)) return false;
  return new Set(token).size / token.length >= 0.4;
}

/** Two letters or digits: neither a word nor a sign of random text ("tv", "9w", "a4"). */
const neutral = (token: string) => token.length <= 2 || /\d/.test(token);

const SENTENCE_WORDS = new Set([
  'who',
  'what',
  'why',
  'how',
  'when',
  'where',
  'is',
  'are',
  'was',
  'my',
  'me',
  'you',
  'your',
  'we',
  'our',
  'i',
  'he',
  'she',
  'they',
  'kaun',
  'kyun',
  'kaise',
  'kab',
  'kahan',
  'mera',
  'meri',
  'mere',
  'tum',
  'aap',
  'hum',
  'aayega',
  'hoga',
  'hai',
  'hain',
]);
const MAX_WORDS = 6;

const VEHICLES = [
  'car',
  'cars',
  'bike',
  'scooter',
  'scooty',
  'motorcycle',
  'truck',
  'bus',
  'taxi',
  'tesla',
  'bmw',
  'audi',
  'mercedes',
  'swift',
  'creta',
  'innova',
  'fortuner',
  'activa',
  'splendor',
  'maruti',
  'honda',
  'hyundai',
  'tata',
  'mahindra',
];
const GADGETS = [
  'iphone',
  'ipad',
  'macbook',
  'laptop',
  'smartphone',
  'galaxy',
  'pixel',
  'oneplus',
  'redmi',
  'oppo',
  'vivo',
  'realme',
  'samsung',
  'tablet',
];
const PROPERTY = [
  'flat',
  'house',
  'plot',
  'land',
  'apartment',
  'bhk',
  '2bhk',
  '3bhk',
  '1bhk',
  'villa',
  'makaan',
  'zameen',
  'rent',
];
const SERVICES = [
  'plumber',
  'electrician',
  'carpenter',
  'tutor',
  'driver',
  'maid',
  'nurse',
  'doctor',
  'dentist',
  'lawyer',
  'mechanic',
  'repair',
  'service',
  'booking',
  'ticket',
  'recharge',
  'loan',
  'insurance',
];
const PLACES = [
  'indore',
  'delhi',
  'mumbai',
  'bhopal',
  'ujjain',
  'pune',
  'jaipur',
  'bangalore',
  'kolkata',
  'chennai',
  'hyderabad',
];
/** A word that says the thing is a part, an accessory, a toy or a care product, not the big item. */
const PRODUCT_OF = new Set([
  'cover',
  'case',
  'charger',
  'cable',
  'guard',
  'holder',
  'stand',
  'sleeve',
  'skin',
  'adapter',
  'earphone',
  'earphones',
  'cleaner',
  'polish',
  'freshener',
  'toy',
  'toys',
  'model',
  'shampoo',
  'perfume',
  'wash',
  'oil',
  'key',
  'keychain',
  'lock',
  'light',
  'bulb',
  'bag',
  'chain',
  'mat',
  'sticker',
  'battery',
  'glass',
  'pouch',
  'tyre',
  'pump',
  'brush',
]);
const OUT_OF_SCOPE = new Set([...VEHICLES, ...GADGETS, ...PROPERTY, ...SERVICES, ...PLACES]);

export function checkProductName(text: string): Sanity {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const letters = tokens.filter((t) => !neutral(t));
  const good = letters.filter(wordLike);
  // At least one word-like token, and at least half of the real-length tokens are word-like.
  if (good.length === 0 || good.length * 2 < letters.length)
    return { ok: false, reason: 'not_words' };
  // "ababababab" or "aaaa bbbb": barely any different letters for the length.
  const joined = tokens.join('');
  if (joined.length >= 6 && new Set(joined).size / joined.length < 0.3)
    return { ok: false, reason: 'not_words' };
  if (tokens.length > MAX_WORDS || tokens.some((t) => SENTENCE_WORDS.has(t)))
    return { ok: false, reason: 'sentence' };
  if (tokens.some((t) => OUT_OF_SCOPE.has(t)) && !tokens.some((t) => PRODUCT_OF.has(t)))
    return { ok: false, reason: 'out_of_scope' };
  return { ok: true };
}
