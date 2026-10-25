import { ApiError } from './api.js';
import { noteRequestId } from './clientErrors.js';

const made = new WeakMap<object, string>();

/**
 * The ref to quote for a failure: the server's own when it gave one, else one made here (the
 * server was not reached, or a proxy answered), so no error the customer sees is without a ref.
 */
export function refOf(error: unknown): string {
  if (error instanceof ApiError && error.requestId) return error.requestId;
  const key = typeof error === 'object' && error !== null ? error : null;
  const known = key && made.get(key);
  if (known) return known;
  const ref = `C-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  if (key) made.set(key, ref);
  noteRequestId(ref);
  return ref;
}

/** A message the customer can read out to us: the words, then the ref. */
export const withRef = (
  message: string,
  error: unknown,
  refLine: (ref: string) => string,
): string => `${message} ${refLine(refOf(error))}`;
