import { createHash } from 'node:crypto';
import { firstLine, normaliseQuery } from './normalise.js';

const MIN_CHARS = 2;
const MAX_CHARS = 60;

/** Latin letters, digits, spaces and Devanagari: nothing else is a name we store. */
const ALLOWED = /^[a-z0-9ऀ-ॿ ]+$/;
const LINK = /https?:|www\.|@|\.(?:com|in|org|net|co|io|me|ly|app)(?:\b|\/)/i;
const SPACED_DIGITS = /(?<=\d)[\s.-]+(?=\d)/g;
const PHONE_LIKE = /\d{6,}/;

/**
 * The display name for a new item, or null when the text is not fit to store (ADR-0028): 2 to 60
 * characters, letters, digits, spaces and Devanagari only, no URL or email, no run of 6 or more
 * digits (a phone number written with spaces counts). Any other character rejects the name. The
 * display name is the normalised query (filler words and a quantity such as "5 kg" are dropped).
 */
export function cleanItemName(raw: string): string | null {
  const line = firstLine(raw);
  if (LINK.test(line)) return null;
  if (PHONE_LIKE.test(line.replace(SPACED_DIGITS, ''))) return null;
  if (!ALLOWED.test(line.toLowerCase())) return null;
  const { text } = normaliseQuery(line);
  const chars = [...text].length;
  if (chars < MIN_CHARS || chars > MAX_CHARS) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `u-` plus a hash of the normalised name: the same product always gets the same slug, and never a catalog one. */
export const slugForUserItem = (text: string): string =>
  `u-${createHash('sha256').update(normaliseQuery(text).text).digest('hex').slice(0, 12)}`;
