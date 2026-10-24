import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStore, createRedisStore, type RedisLike } from './http/ipLimit.js';
import { createUserLimiter } from './modules/ai/index.js';
import { createRateLimiter } from './modules/push/index.js';
import { createPingDedupe } from './workers/pingDedupe.js';
import { startErrandWorker } from './workers/errandWorker.js';
import { connect, QUEUE_TIMEOUT_MS } from './workers/redis.js';

/**
 * PR F1: Redis failures that were assumed, now triggered for real in throwaway containers
 * (recorded by scripts/probe/record-local-failures.ts, fixtures in testing/observed/redis-*.json).
 * Observed: with maxmemory reached and noeviction, INCR, EVAL and every BullMQ add are refused with
 * `ReplyError: OOM command not allowed when used memory > 'maxmemory'` at once (no error code, no
 * hang), reads still work; with Redis stopped, a producer connection with maxRetriesPerRequest
 * null waits for ever. These tests pin down what each caller does with that.
 */
const logger = pino({ level: 'silent' });
const OOM = /OOM command not allowed/;

async function startFullRedis() {
  const container = await new GenericContainer('redis:8.8.3-alpine')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--maxmemory', '2mb', '--maxmemory-policy', 'noeviction'])
    .start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  const admin = connect(url, logger, { maxRetriesPerRequest: 1, commandTimeout: 1000 });
  // Many small values until a counter write is refused (a single big command is refused for its own
  // buffer, not for a full dataset, and a write right at the limit can still squeeze in).
  const blob = 'x'.repeat(500);
  let full = false;
  for (let i = 0; i < 20_000 && !full; i++) {
    await admin.set(`fill:${i}`, blob).catch(() => undefined);
    if (i % 10 === 0)
      full = await admin.incr(`probe:${i}`).then(
        () => false,
        (e: Error) => OOM.test(e.message),
      );
  }
  expect(full).toBe(true);
  return { container, url, admin };
}

describe('Redis is full (maxmemory reached, noeviction)', () => {
  let container: StartedTestContainer;
  let url: string;
  let redis: ReturnType<typeof connect>;

  beforeAll(async () => {
    ({ container, url, admin: redis } = await startFullRedis());
  }, 120_000);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });

  it('a queued job is refused at once with the OOM error, not left hanging (an errand ends queue_unavailable)', async () => {
    const worker = startErrandWorker({ redisUrl: url, logger, run: async () => undefined });
    try {
      const started = Date.now();
      await expect(worker.enqueue('11111111-1111-4111-8111-111111111111')).rejects.toThrow(OOM);
      expect(Date.now() - started).toBeLessThan(QUEUE_TIMEOUT_MS);
    } finally {
      await worker.close();
    }
  }, 30_000);

  it('the sign-in and route IP limiter counts in memory instead (the OOM error is swallowed)', async () => {
    const store = createRedisStore(redis as unknown as RedisLike, createMemoryStore());
    await expect(store.hit('ip:test', 60_000)).resolves.toMatchObject({ count: 1 });
    await expect(store.hit('ip:test', 60_000)).resolves.toMatchObject({ count: 2 });
  });

  it('the LLM, push and ping-dedupe counters fail open', async () => {
    const warnings: unknown[] = [];
    const llm = createUserLimiter({
      redis: { incr: (k) => redis.incr(k), expire: (k, s) => redis.expire(k, s) },
      logger: { warn: (o: unknown) => warnings.push(o) } as never,
    });
    await expect(llm.allow('user-1')).resolves.toBe(true);
    expect(JSON.stringify(warnings)).toMatch(OOM);

    const push = createRateLimiter(
      { incr: (k) => redis.incr(k), expire: (k, s) => redis.expire(k, s) },
      { max: 1, windowSeconds: 60 },
    );
    await expect(push.allow('u')).resolves.toBe(true);
    await expect(push.allow('u')).resolves.toBe(true); // not counted: no limit while Redis is full

    const dedupe = createPingDedupe(
      redis as unknown as Parameters<typeof createPingDedupe>[0],
      logger,
      30,
    );
    await expect(dedupe.claim('shop', 'item')).resolves.toBe(true);
    await expect(dedupe.claim('shop', 'item')).resolves.toBe(true); // a duplicate ping, as documented
  });
});

describe('Redis is stopped', () => {
  it('a producer connection that retries for ever (the queues) never answers, and our 2 s timeout is the only thing that ends the wait', async () => {
    const container = await new GenericContainer('redis:8.8.3-alpine')
      .withExposedPorts(6379)
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    const worker = startErrandWorker({ redisUrl: url, logger, run: async () => undefined });
    try {
      await new Promise((r) => setTimeout(r, 500));
      await container.stop();
      const started = Date.now();
      await expect(worker.enqueue('22222222-2222-4222-8222-222222222222')).rejects.toThrow(
        /queueing the errand job timed out after 2000 ms/,
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(QUEUE_TIMEOUT_MS - 100);
    } finally {
      await worker.close();
    }
  }, 60_000);

  it('the fail-fast connections (maxRetriesPerRequest 1, commandTimeout) reject within a second and the limiters allow', async () => {
    const container = await new GenericContainer('redis:8.8.3-alpine')
      .withExposedPorts(6379)
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    const strict = connect(url, logger, { maxRetriesPerRequest: 1, commandTimeout: 500 });
    try {
      await strict.ping();
      await container.stop();
      const llm = createUserLimiter({
        redis: { incr: (k) => strict.incr(k), expire: (k, s) => strict.expire(k, s) },
        logger,
      });
      const started = Date.now();
      await expect(llm.allow('user-1')).resolves.toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
      const store = createRedisStore(strict as unknown as RedisLike, createMemoryStore());
      await expect(store.hit('ip:down', 60_000)).resolves.toMatchObject({ count: 1 });
    } finally {
      strict.disconnect();
    }
  }, 60_000);
});
