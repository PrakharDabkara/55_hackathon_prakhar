import { randomBytes } from 'node:crypto';

// Incoming ids end up in every log line, so accept only a short, plain charset.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Six hex digits, easy to read out on a call: "7F3A2C". */
export const newRequestId = (): string => randomBytes(3).toString('hex').toUpperCase();

/** Reuses the caller's x-request-id when it is safe, otherwise generates one. */
export function pickRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : newRequestId();
}

/** True for an id a client may send back to us (a report names the request it saw fail). */
export const isSafeRequestId = (value: string): boolean => SAFE_ID.test(value);
