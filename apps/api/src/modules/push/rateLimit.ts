/** The two Redis commands a fixed-window counter needs. */
export interface CounterStore {
  incr(key: string): Promise<number>;
  /** Sets the expiry only if the key has none yet (EXPIRE ... NX), so the window does not slide. */
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RateLimiter {
  /** True if this person may be pushed now; counts the push. */
  allow(userId: string): Promise<boolean>;
}

/**
 * At most `max` pushes per person per window (ADR-0034), so a busy shop's phone is not buzzing every
 * second. Fails open: if the counter is away the push goes out, because a missed limit costs a
 * buzz and a missed push costs an order.
 */
export function createRateLimiter(
  store: CounterStore,
  { max, windowSeconds }: { max: number; windowSeconds: number },
): RateLimiter {
  return {
    async allow(userId) {
      const key = `push:rate:${userId}`;
      try {
        const count = await store.incr(key);
        await store.expire(key, windowSeconds);
        return count <= max;
      } catch {
        return true;
      }
    },
  };
}
