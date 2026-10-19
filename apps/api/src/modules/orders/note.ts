import { stripPhoneNumbers } from '../push/index.js';

const NOTE_MAX = 140;

/** The customer's note for the shop: one line, no control characters, no phone number, 140 at most. */
export function cleanNote(raw: string | undefined): string | null {
  const text = stripPhoneNumbers((raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text.slice(0, NOTE_MAX) : null;
}
