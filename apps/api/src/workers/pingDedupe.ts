import type { Logger } from 'pino';

/** The slice of ioredis we use. */
export interface RedisLike {
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
  del(key: string): Promise<number>;
}

export interface PingDedupe {
  /** True if this shop may be pinged for this item now; false if it was pinged inside the window. */
  claim(shopId: string, itemId: string): Promise<boolean>;
  /** Give the claim back (the ping was never sent). Never throws. */
  release(shopId: string, itemId: string): Promise<void>;
}

const key = (shopId: string, itemId: string) => `ping-dedupe-${shopId}-${itemId}`;

/**
 * At most one ping per shop per item per window. `SET key NX EX` is one atomic command, so two
 * fan-outs racing for the same shop cannot both win. If Redis is down we send anyway and log it:
 * a duplicate ping is acceptable, a failed request is not.
 */
export function createPingDedupe(
  redis: RedisLike | null,
  logger: Logger,
  windowMinutes: number,
): PingDedupe {
  return {
    async claim(shopId, itemId) {
      if (!redis) return true;
      try {
        return (await redis.set(key(shopId, itemId), '1', 'EX', windowMinutes * 60, 'NX')) === 'OK';
      } catch (err) {
        logger.warn({ reason: (err as Error).message }, 'ping dedupe unavailable, pinging anyway');
        return true;
      }
    },
    async release(shopId, itemId) {
      if (!redis) return;
      try {
        await redis.del(key(shopId, itemId));
      } catch {
        // Best effort: the key expires by itself.
      }
    },
  };
}
