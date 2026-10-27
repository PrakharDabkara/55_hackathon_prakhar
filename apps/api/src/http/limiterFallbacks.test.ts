import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore, createRedisStore, type RedisLike } from './ipLimit.js';
import { createFallbackMonitor } from './limiterFallbacks.js';

const WINDOW_MS = 10 * 60_000;

const fakeLogger = () => {
  const warn = vi.fn();
  return { warn, logger: { warn } as unknown as Logger };
};

describe('createRedisStore: telling the monitor about a fallback', () => {
  it('reports "error" and the bucket name when Redis errors, never the key', async () => {
    const onFallback = vi.fn();
    const redis: RedisLike = { eval: vi.fn(async () => Promise.reject(new Error('down'))) };
    const store = createRedisStore(redis, createMemoryStore(), { onFallback });
    expect((await store.hit('rl:request:203.0.113.7', WINDOW_MS)).count).toBe(1);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith({ reason: 'error', bucket: 'request' });
    expect(JSON.stringify(onFallback.mock.calls)).not.toContain('203.0.113.7');
  });

  it('reports "timeout" when Redis hangs, and when the Redis client itself times out', async () => {
    const onFallback = vi.fn();
    const hangs: RedisLike = { eval: () => new Promise(() => undefined) };
    await createRedisStore(hangs, createMemoryStore(), { timeoutMs: 20, onFallback }).hit(
      'rl:verify:203.0.113.7',
      WINDOW_MS,
    );
    const slow: RedisLike = { eval: async () => Promise.reject(new Error('Command timed out')) };
    await createRedisStore(slow, createMemoryStore(), { onFallback }).hit(
      'rl:inbox:203.0.113.7',
      WINDOW_MS,
    );
    expect(onFallback.mock.calls).toEqual([
      [{ reason: 'timeout', bucket: 'verify' }],
      [{ reason: 'timeout', bucket: 'inbox' }],
    ]);
  });

  it('reports "error" when Redis answers something unexpected', async () => {
    const onFallback = vi.fn();
    const redis: RedisLike = { eval: vi.fn(async () => 'nope') };
    await createRedisStore(redis, createMemoryStore(), { onFallback }).hit('rl:api:::1', WINDOW_MS);
    expect(onFallback).toHaveBeenCalledWith({ reason: 'error', bucket: 'api' });
  });

  it('counts as before even when the monitor throws: logging never changes who is limited', async () => {
    const onFallback = vi.fn(() => {
      throw new Error('logger broke');
    });
    const redis: RedisLike = { eval: vi.fn(async () => Promise.reject(new Error('down'))) };
    const store = createRedisStore(redis, createMemoryStore(), { onFallback });
    expect((await store.hit('rl:request:203.0.113.7', WINDOW_MS)).count).toBe(1);
    expect((await store.hit('rl:request:203.0.113.7', WINDOW_MS)).count).toBe(2);
    expect(onFallback).toHaveBeenCalledTimes(2);
  });

  it('says nothing when Redis answers, and counts exactly as before', async () => {
    const onFallback = vi.fn();
    const redis: RedisLike = { eval: vi.fn(async () => [4, 123_000]) };
    const hit = await createRedisStore(redis, createMemoryStore(), { onFallback }).hit(
      'rl:request:203.0.113.7',
      WINDOW_MS,
    );
    expect(hit).toEqual({ count: 4, retryAfterMs: 123_000 });
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe('createFallbackMonitor', () => {
  it('logs one warn line with the reason and the bucket, and no address or phone', () => {
    const { warn, logger } = fakeLogger();
    const monitor = createFallbackMonitor({ logger });
    monitor.record({ reason: 'timeout', bucket: 'request' });
    expect(warn).toHaveBeenCalledOnce();
    const [fields, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({ reason: 'timeout', bucket: 'request', fallbacks: 1 });
    expect(message).toMatch(/memory/);
  });

  it('logs at most once per interval but counts every fallback', () => {
    let now = Date.parse('2026-10-27T10:00:00Z');
    const { warn, logger } = fakeLogger();
    const monitor = createFallbackMonitor({ logger, now: () => now, logEveryMs: 60_000 });
    for (let i = 0; i < 5; i++) monitor.record({ reason: 'error', bucket: 'request' });
    expect(warn).toHaveBeenCalledOnce();
    expect(monitor.fallbacksToday()).toBe(5);
    now += 60_000;
    monitor.record({ reason: 'error', bucket: 'api' });
    expect(warn).toHaveBeenCalledTimes(2);
    // The second line says how many fell back since the first, so none is lost from the log.
    expect(warn.mock.calls[1]?.[0]).toEqual({ reason: 'error', bucket: 'api', fallbacks: 5 });
    expect(monitor.fallbacksToday()).toBe(6);
  });

  it('starts the count again each UTC day', () => {
    let now = Date.parse('2026-10-27T23:59:00Z');
    const monitor = createFallbackMonitor({ logger: fakeLogger().logger, now: () => now });
    monitor.record({ reason: 'error', bucket: 'request' });
    expect(monitor.fallbacksToday()).toBe(1);
    now = Date.parse('2026-10-28T00:01:00Z');
    expect(monitor.fallbacksToday()).toBe(0);
  });
});
