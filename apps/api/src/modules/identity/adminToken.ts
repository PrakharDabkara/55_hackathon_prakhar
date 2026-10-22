import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Whether `given` is the admin token. Both sides are hashed first, so the comparison always runs on
 * two 32-byte values: a wrong length costs the same time as a wrong character and reveals nothing.
 */
export function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}
