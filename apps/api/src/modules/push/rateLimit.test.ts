import { describe, expect, it } from 'vitest';
import { createRateLimiter, type CounterStore } from './rateLimit.js';

/** A Redis stand-in with a clock the test moves. */
function fakeStore() {
  let now = 0;
  const keys = new Map<string, { n: number; expiresAt: number | null }>();
  const store: CounterStore = {
    async incr(key) {
      const live = keys.get(key);
      if (live?.expiresAt != null && live.expiresAt <= now) keys.delete(key);
      const entry = keys.get(key) ?? { n: 0, expiresAt: null };
      entry.n++;
      keys.set(key, entry);
      return entry.n;
    },
    async expire(key, seconds) {
      const entry = keys.get(key);
      if (entry && entry.expiresAt === null) entry.expiresAt = now + seconds * 1000;
      return 1;
    },
  };
  return { store, advance: (ms: number) => void (now += ms) };
}

describe('the per-user push limit', () => {
  it('lets 5 pushes through in a minute and drops the 6th', async () => {
    const { store } = fakeStore();
    const limiter = createRateLimiter(store, { max: 5, windowSeconds: 60 });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await limiter.allow('user-a'));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('counts each user on their own', async () => {
    const { store } = fakeStore();
    const limiter = createRateLimiter(store, { max: 1, windowSeconds: 60 });
    expect(await limiter.allow('user-a')).toBe(true);
    expect(await limiter.allow('user-a')).toBe(false);
    expect(await limiter.allow('user-b')).toBe(true);
  });

  it('lets pushes through again when the minute is over', async () => {
    const { store, advance } = fakeStore();
    const limiter = createRateLimiter(store, { max: 2, windowSeconds: 60 });
    await limiter.allow('u');
    await limiter.allow('u');
    expect(await limiter.allow('u')).toBe(false);
    advance(61_000);
    expect(await limiter.allow('u')).toBe(true);
  });

  it('lets the push through when the counter store is down: a missed limit beats a missed push', async () => {
    const limiter = createRateLimiter(
      {
        incr: () => Promise.reject(new Error('redis away')),
        expire: () => Promise.reject(new Error('redis away')),
      },
      { max: 1, windowSeconds: 60 },
    );
    expect(await limiter.allow('u')).toBe(true);
    expect(await limiter.allow('u')).toBe(true);
  });
});
