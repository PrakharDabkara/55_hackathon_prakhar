import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRedis } from '../testing/startRedis.js';
import { connect } from '../workers/redis.js';
import { createMemoryStore, createRedisStore } from './ipLimit.js';

const WINDOW_MS = 10 * 60_000;

describe('the Redis-backed IP limit store', () => {
  let redisServer: Awaited<ReturnType<typeof startRedis>>;
  let a: Redis;
  let b: Redis;

  beforeAll(async () => {
    redisServer = await startRedis();
    const quiet = pino({ level: 'silent' });
    const options = { maxRetriesPerRequest: 1, commandTimeout: 500 };
    a = connect(redisServer.url, quiet, options);
    b = connect(redisServer.url, quiet, options);
  }, 120_000);

  afterAll(async () => {
    a?.disconnect();
    b?.disconnect();
    await redisServer?.stop().catch(() => undefined);
  });

  it('counts across API instances and sets the window once', async () => {
    const one = createRedisStore(a, createMemoryStore());
    const two = createRedisStore(b, createMemoryStore());
    expect((await one.hit('t:shared', WINDOW_MS)).count).toBe(1);
    const second = await two.hit('t:shared', WINDOW_MS);
    expect(second.count).toBe(2);
    expect(second.retryAfterMs).toBeGreaterThan(WINDOW_MS - 5000);
    expect(second.retryAfterMs).toBeLessThanOrEqual(WINDOW_MS);
    // The key expires on its own: a hit never extends the window.
    expect(await a.pttl('t:shared')).toBeLessThanOrEqual(WINDOW_MS);
  });

  it('keeps limiting from memory when Redis goes away (never fails open)', async () => {
    const store = createRedisStore(a, createMemoryStore(), { timeoutMs: 300 });
    expect((await store.hit('t:outage', WINDOW_MS)).count).toBe(1);
    await redisServer.stop();
    expect((await store.hit('t:outage-2', WINDOW_MS)).count).toBe(1);
    expect((await store.hit('t:outage-2', WINDOW_MS)).count).toBe(2);
    expect((await store.hit('t:outage-2', WINDOW_MS)).count).toBe(3);
  }, 30_000);
});
