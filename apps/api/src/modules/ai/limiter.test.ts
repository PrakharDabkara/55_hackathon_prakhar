import { describe, expect, it } from 'vitest';
import { createUserLimiter } from './limiter.js';

function fakeRedis() {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  return {
    counts,
    expiries,
    incr: async (key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key) as number;
    },
    expire: async (key: string, seconds: number) => {
      expiries.set(key, seconds);
      return 1;
    },
  };
}

describe('createUserLimiter', () => {
  it('allows 30 LLM resolutions per user per hour, then refuses', async () => {
    const limiter = createUserLimiter({ redis: fakeRedis(), now: () => 0 });
    for (let i = 0; i < 30; i++) expect(await limiter.allow('u1')).toBe(true);
    expect(await limiter.allow('u1')).toBe(false);
  });

  it('counts each user separately', async () => {
    const limiter = createUserLimiter({ redis: fakeRedis(), max: 1, now: () => 0 });
    expect(await limiter.allow('u1')).toBe(true);
    expect(await limiter.allow('u1')).toBe(false);
    expect(await limiter.allow('u2')).toBe(true);
  });

  it('starts a new count each hour, and the counter expires by itself', async () => {
    const redis = fakeRedis();
    let now = 0;
    const limiter = createUserLimiter({ redis, max: 1, now: () => now });
    expect(await limiter.allow('u1')).toBe(true);
    expect(await limiter.allow('u1')).toBe(false);
    now += 3_600_000;
    expect(await limiter.allow('u1')).toBe(true);
    expect([...redis.expiries.values()].every((s) => s >= 3600)).toBe(true);
  });

  it('fails open: a Redis error, or no Redis at all, allows the call', async () => {
    const broken = createUserLimiter({
      redis: {
        incr: async () => {
          throw new Error('redis is down');
        },
        expire: async () => 1,
      },
    });
    expect(await broken.allow('u1')).toBe(true);
    expect(await createUserLimiter({ redis: null }).allow('u1')).toBe(true);
  });

  it('keeps the user id out of nothing but the Redis key it needs, hashed', async () => {
    const redis = fakeRedis();
    await createUserLimiter({ redis, now: () => 0 }).allow('9c1f-user-id');
    expect([...redis.counts.keys()][0]).toMatch(/^llm:user:/);
  });
});
