/**
 * Layer 1 of the safety block (ADR-0029): a curated list of things no shop is ever asked about.
 * Deterministic and free, so it runs before any model sees the text. Terms are whole words or
 * whole phrases, in Latin (English, Hinglish) and Devanagari. The list is short on purpose: the
 * model is layer 2. Add a term only for something that is never a legitimate shop item, and add
 * an `ALLOWED_PHRASES` entry for an everyday product that shares its word.
 */
export interface DenyRule {
  id: 'weapons' | 'explosives' | 'drugs' | 'counterfeit';
  terms: string[];
}

export const DENY_RULES: DenyRule[] = [
  {
    id: 'weapons',
    terms: [
      'gun',
      'guns',
      'pistol',
      'revolver',
      'rifle',
      'firearm',
      'firearms',
      'weapon',
      'weapons',
      'ammo',
      'ammunition',
      'bullets',
      'live cartridge',
      'live cartridges',
      'grenade',
      'katta',
      'tamancha',
      'tamanche',
      'bandook',
      'bandooq',
      'बंदूक',
      'तमंचा',
      'तमंचे',
      'कट्टा',
      'पिस्तौल',
      'रिवॉल्वर',
      'राइफल',
      'कारतूस',
      'हथगोला',
      'हथियार',
    ],
  },
  {
    id: 'explosives',
    terms: [
      'bomb',
      'bombs',
      'explosive',
      'explosives',
      'dynamite',
      'detonator',
      'detonators',
      'tnt',
      'rdx',
      'gelatin sticks',
      'gun powder',
      'gunpowder',
      'barood',
      'baarood',
      'बम',
      'बारूद',
      'विस्फोटक',
      'डायनामाइट',
    ],
  },
  {
    id: 'drugs',
    terms: [
      'cocaine',
      'heroin',
      'charas',
      'ganja',
      'afeem',
      'opium',
      'brown sugar',
      'smack',
      'mdma',
      'lsd',
      'meth',
      'marijuana',
      'hashish',
      'cannabis',
      'fentanyl',
      'mephedrone',
      'गांजा',
      'चरस',
      'अफीम',
      'अफ़ीम',
      'कोकीन',
      'हेरोइन',
      'स्मैक',
      'ब्राउन शुगर',
    ],
  },
  {
    id: 'counterfeit',
    terms: [
      'fake currency',
      'fake notes',
      'fake note',
      'counterfeit',
      'jaali note',
      'jali note',
      'नकली नोट',
      'जाली नोट',
    ],
  },
];

/** Everyday products that contain a listed word. Removed from the text before the terms are looked for. */
const ALLOWED_PHRASES = [
  'glue gun',
  'hot glue gun',
  'staple gun',
  'stapler gun',
  'heat gun',
  'spray gun',
  'water gun',
  'nail gun',
  'grease gun',
  'caulking gun',
  'bath bomb',
  'bath bombs',
  'bullet journal',
  'bullet point',
  'bullet points',
  'printer cartridge',
  'ink cartridge',
  'toner cartridge',
  'gas cartridge',
  'water filter cartridge',
  'filter cartridge',
  'pen cartridge',
  'fevicol gun',
];

const NOT_WORD = /[^\p{L}\p{M}\p{N}]+/gu;
const words = (text: string): string =>
  ` ${text.normalize('NFC').toLowerCase().replace(NOT_WORD, ' ').trim()} `;

const contains = (haystack: string, term: string): boolean => haystack.includes(` ${term} `);

/**
 * The rule that blocks `text`, or null. The longest listed term wins, so "gun powder" is an
 * explosive, not a weapon. Returns only the rule id: that, and not the text, is what gets logged.
 */
export function checkDenyList(text: string): { rule: DenyRule['id'] } | null {
  let haystack = words(text);
  for (const phrase of ALLOWED_PHRASES) haystack = haystack.split(words(phrase)).join(' ');
  let best: { rule: DenyRule['id']; length: number } | null = null;
  for (const rule of DENY_RULES) {
    for (const term of rule.terms) {
      if (contains(haystack, term) && (!best || term.length > best.length))
        best = { rule: rule.id, length: term.length };
    }
  }
  return best ? { rule: best.rule } : null;
}
