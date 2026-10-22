import { InvalidOutputError } from './types.js';

export type PrivacyViolation = 'phone' | 'email' | 'coordinates' | 'address_field';

/** Ids are not private, and a UUID's tail can look like a number: take them out before looking. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const EMAIL_ONE = new RegExp(EMAIL.source);
/** A run of digits that may be split by single spaces or dashes (a phone is written many ways). */
const DIGIT_RUN = /(?<![\d.,])\+?\d(?:[ -]?\d)*(?![\d]|[.,]\d)/g;
const COORDINATES = /(-?\d{1,3}\.\d{4,})\s*[,;/]?\s*(-?\d{1,3}\.\d{4,})/g;
/** JSON keys and labels that only ever hold a person's contact, home or location. */
const FIELD_NAME =
  /(?<![A-Za-z0-9_])["']?(?:lat|lng|lon|latitude|longitude|address|address_?line_?\d?|address_?text|delivery_?address(?:_?id)?|address_?id|pin_?code|landmark|phone|phone_?number|mobile|email|user_?id|owner_?user_?id)["']?\s*[:=]/i;

const REMOVED = '[removed]';

/** Ten digits (an Indian mobile), or the same with the 0, 91, 091 or 0091 in front. */
function isPhoneRun(run: string): boolean {
  const groups = run.replace(/^\+/, '').split(/[ -]/);
  // Split groups are phone-like only when each is 3+ digits (the country prefix may be short).
  const rest = ['0', '91', '091', '0091'].includes(groups[0] as string) ? groups.slice(1) : groups;
  if (groups.length > 1 && rest.some((g) => g.length < 3)) return false;
  const digits = groups.join('');
  return (
    digits.length === 10 ||
    (digits.length === 11 && digits.startsWith('0')) ||
    (digits.length === 12 && digits.startsWith('91')) ||
    (digits.length === 13 && digits.startsWith('091')) ||
    (digits.length === 14 && digits.startsWith('0091'))
  );
}

const isCoordinatePair = (a: string, b: string) =>
  Math.abs(Number(a)) <= 90 && Math.abs(Number(b)) <= 180;

/** What kind of private data the text holds, or null. Never returns the data itself. */
export function findPrivateData(text: string): PrivacyViolation | null {
  const plain = text.replace(UUID, ' ');
  if (FIELD_NAME.test(plain)) return 'address_field';
  if (EMAIL_ONE.test(plain)) return 'email';
  for (const [run] of plain.matchAll(DIGIT_RUN)) if (isPhoneRun(run)) return 'phone';
  for (const [, a, b] of plain.matchAll(COORDINATES))
    if (isCoordinatePair(a as string, b as string)) return 'coordinates';
  return null;
}

/** For text a shop wrote: phones, emails and coordinates become "[removed]" so they never reach the model. */
export function redactPrivateData(text: string): string {
  return text
    .replace(EMAIL, REMOVED)
    .replace(DIGIT_RUN, (run) => (isPhoneRun(run) ? REMOVED : run))
    .replace(COORDINATES, (pair, a: string, b: string) =>
      isCoordinatePair(a, b) ? REMOVED : pair,
    );
}

/**
 * Thrown before a request leaves the server. It is an InvalidOutputError so the client does not
 * retry it and does not count it against the circuit breaker (a customer typing a phone number
 * must not switch the model off for everyone). The message names the reason, never the content.
 */
export class PrivacyGuardError extends InvalidOutputError {
  readonly reason: PrivacyViolation;
  constructor(reason: PrivacyViolation) {
    super(`privacy guard blocked the prompt: ${reason}`);
    this.name = 'PrivacyGuardError';
    this.reason = reason;
  }
}

/** The last check before any text goes to a model (ADR-0060). Throws PrivacyGuardError. */
export function assertNoPrivateData(texts: string[]): void {
  for (const text of texts) {
    const reason = findPrivateData(text);
    if (reason) throw new PrivacyGuardError(reason);
  }
}
