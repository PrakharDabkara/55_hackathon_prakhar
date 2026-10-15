import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export interface UserLimiter {
  allow(userId: string): Promise<boolean>;
}

export interface RedisCounter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const HOUR_MS = 3_600_000;

/**
 * At most `max` LLM resolutions per user per hour, counted in Redis. It fails open: if Redis is
 * away (or absent) the call is allowed, because a missed limit costs a few tokens and a refused
 * search costs a customer.
 */
export function createUserLimiter({
  redis,
  max = 30,
  now = Date.now,
  logger,
}: {
  redis: RedisCounter | null;
  max?: number;
  now?: () => number;
  logger?: Logger;
}): UserLimiter {
  return {
    async allow(userId) {
      if (!redis) return true;
      try {
        const hour = Math.floor(now() / HOUR_MS);
        // The user id never leaves the process in clear: the key is a hash.
        const key = `llm:user:${createHash('sha256').update(userId).digest('hex').slice(0, 16)}:${hour}`;
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, 2 * 3600);
        return count <= max;
      } catch (error) {
        logger?.warn({ reason: (error as Error).message }, 'LLM limit check failed; allowing');
        return true;
      }
    },
  };
}
