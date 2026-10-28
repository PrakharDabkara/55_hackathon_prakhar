import type { Request } from 'express';
import { createHmac, randomBytes } from 'node:crypto';

export type KeyDiag = (req: Request, limiter: string, key: string) => void;

/**
 * Temporary (LIMITER_DIAG=on, ADR-0058): one log line per limited request saying which bucket it
 * landed in, as an 8-hex keyed hash of the limiter key. The salt is random per process and never
 * logged, so a hash can be compared with another from the same run but not turned back into an
 * address. Also the number of X-Forwarded-For entries (a count, never the values). The request id
 * is on the line like on every other.
 */
export function createKeyDiag(): KeyDiag {
  const salt = randomBytes(16);
  return (req, limiter, key) => {
    const header = req.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
    req.log.info(
      {
        limiter,
        keyHash: createHmac('sha256', salt).update(key).digest('hex').slice(0, 8),
        family: key.includes(':') ? 'v6' : key === 'unknown' ? 'none' : 'v4',
        xffEntries: raw.trim() === '' ? 0 : raw.split(',').length,
      },
      'limiter key',
    );
  };
}
