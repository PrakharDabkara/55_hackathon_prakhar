import { isTypoOf, normaliseQuery } from '../catalog/index.js';

/**
 * What the customer named, worked out in code from their own words (ADR-0049). The model's
 * checklist and plan are checked against this, so a named thing can never be dropped and an item the
 * agent added on its own is never asked about before the customer confirmed it.
 */

/** Pieces of a task: a comma, semicolon, new line, "+", "&", or the words "aur" and "and". */
const SPLIT = /[,;\n+&]|\s(?:aur|and)\s/giu;

/**
 * After one of these the items of a goal follow ("bachche ke project ke liye <items>"). The
 * normaliser has already dropped "ke", so "ke liye" is "liye" here.
 */
const FOR_MARKER = /\b(?:liye|lie|for)\b/u;

/**
 * A piece that states a goal ("poha banane ka saaman", "ghar ki safai ka saaman") names no item to
 * buy: what to buy is for the agent to propose and the customer to confirm.
 */
const GOAL = /\b(?:banane|banana|bana|saaman|samaan|saman|safai|supplies|stuff)\b/u;

const GENERIC = new Set([
  'project',
  'party',
  'trip',
  'things',
  'thing',
  'items',
  'item',
  'school',
  'home',
  'college',
  'function',
  'event',
  'gift',
]);

/** The things a task names, each as the normalised words the customer used. Goals name nothing. */
export function namedFragments(task: string): string[] {
  const out: string[] = [];
  for (const piece of task.normalize('NFC').split(SPLIT)) {
    let text = normaliseQuery(piece).text;
    if (!text) continue;
    const marker = [...text.matchAll(new RegExp(FOR_MARKER, 'gu'))].at(-1);
    if (marker?.index !== undefined) text = text.slice(marker.index + marker[0].length).trim();
    if (!text || GOAL.test(text)) continue;
    // "things for a school project": only generic words, no item.
    if (text.split(' ').every((w) => GENERIC.has(w))) continue;
    out.push(text);
  }
  return out;
}

const words = (text: string): string[] => normaliseQuery(text).text.split(' ').filter(Boolean);

const sameWord = (a: string, b: string): boolean => a === b || (a.length >= 4 && isTypoOf(a, b));

/** Every word of `a` is a word (or a typo of one) of `b`. */
const within = (a: string[], b: string[]): boolean =>
  a.length > 0 && a.every((x) => b.some((y) => sameWord(x, y)));

/**
 * Does `candidate` (a plan item, a question option, a resolved word) stand for the named `fragment`?
 * Same words in any order or case; one a typo of the other; or one contained in the other
 * ("paper" and "chart paper").
 */
export function covers(fragment: string, candidate: string): boolean {
  const a = words(fragment);
  const b = words(candidate);
  return within(a, b) || within(b, a);
}

/** The named things that none of the candidates covers, in the order they were named. */
export function uncovered(named: string[], candidates: string[]): string[] {
  return named.filter((fragment) => !candidates.some((c) => covers(fragment, c)));
}
