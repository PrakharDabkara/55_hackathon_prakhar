import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './errors.js';
import {
  createIpLimiter,
  createMemoryStore,
  createRedisStore,
  ipKey,
  type RedisLike,
} from './ipLimit.js';

const WINDOW_MS = 10 * 60_000;

function appWith(limiter: express.RequestHandler, hops = 1) {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/x', limiter, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler(pino({ level: 'silent' })));
  return app;
}

const from = (app: express.Express, ip: string) =>
  request(app).get('/x').set('X-Forwarded-For', ip);

describe('ipKey', () => {
  it('keeps an IPv4 address as it is, and unwraps an IPv4-mapped IPv6 one', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('puts every address of one IPv6 /64 in the same bucket', () => {
    expect(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(ipKey('2001:db8:1:2::1'));
    expect(ipKey('2001:db8:1:2::1')).not.toBe(ipKey('2001:db8:1:3::1'));
  });

  it('unwraps an IPv4-mapped address however it is written', () => {
    expect(ipKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(ipKey('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('0:0:0:0:0:ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('gives one key to one /64 however the address is written', () => {
    expect(ipKey('2001:DB8:1:2::1')).toBe(ipKey('2001:db8:1:2:0:0:0:1'));
    expect(ipKey('2001:db8:1:2::1%eth0')).toBe(ipKey('2001:db8:1:2::9'));
    expect(ipKey('::1')).toBe('0:0:0:0');
  });

  it('does not collapse unrelated mapped or IPv6 clients into one bucket', () => {
    expect(ipKey('::ffff:cb00:7109')).not.toBe(ipKey('::ffff:cb00:710a'));
    expect(ipKey('2001:db8:1:2::1')).not.toBe(ipKey('2001:db8:1:3::1'));
    expect(ipKey('203.0.113.7')).not.toBe(ipKey('2001:db8:1:2::1'));
  });

  it('never uses text that is not an IP address as a key', () => {
    expect(ipKey('not an ip')).toBe('unknown');
    expect(ipKey('x'.repeat(500))).toBe('unknown');
  });

  it('never returns an empty key', () => {
    expect(ipKey(undefined)).toBe('unknown');
    expect(ipKey('')).toBe('unknown');
  });
});

describe('createIpLimiter with a diagnostic', () => {
  it('limits exactly the same when the diagnostic throws', async () => {
    const diag = () => {
      throw new Error('diagnostic broke');
    };
    const app = appWith(
      createIpLimiter({ name: 't', max: 2, windowMs: WINDOW_MS, store: createMemoryStore(), diag }),
    );
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await from(app, '203.0.113.1')).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe('createIpLimiter with the in-memory store', () => {
  it('lets max requests through, then answers 429 with Retry-After', async () => {
    const app = appWith(
      createIpLimiter({ name: 't', max: 3, windowMs: WINDOW_MS, store: createMemoryStore() }),
    );
    for (let i = 0; i < 3; i++) expect((await from(app, '203.0.113.1')).status).toBe(200);
    const blocked = await from(app, '203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    const retry = Number(blocked.headers['retry-after']);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it('counts each IP on its own', async () => {
    const app = appWith(
      createIpLimiter({ name: 't', max: 1, windowMs: WINDOW_MS, store: createMemoryStore() }),
    );
    expect((await from(app, '203.0.113.1')).status).toBe(200);
    expect((await from(app, '203.0.113.1')).status).toBe(429);
    expect((await from(app, '203.0.113.2')).status).toBe(200);
  });

  it('keeps separate counters per limiter name on one store', async () => {
    const store = createMemoryStore();
    const a = appWith(createIpLimiter({ name: 'a', max: 1, windowMs: WINDOW_MS, store }));
    const b = appWith(createIpLimiter({ name: 'b', max: 1, windowMs: WINDOW_MS, store }));
    expect((await from(a, '203.0.113.1')).status).toBe(200);
    expect((await from(b, '203.0.113.1')).status).toBe(200);
  });

  it('opens a new window after the old one ends', async () => {
    let now = 1_000_000;
    const store = createMemoryStore({ now: () => now });
    const app = appWith(createIpLimiter({ name: 't', max: 1, windowMs: WINDOW_MS, store }));
    expect((await from(app, '203.0.113.1')).status).toBe(200);
    expect((await from(app, '203.0.113.1')).status).toBe(429);
    now += WINDOW_MS + 1;
    expect((await from(app, '203.0.113.1')).status).toBe(200);
  });

  it('stays bounded: past maxKeys the oldest entries go, the newest still count', async () => {
    const store = createMemoryStore({ maxKeys: 3 });
    for (let i = 0; i < 10; i++) await store.hit(`k${i}`, WINDOW_MS);
    expect(store.size()).toBeLessThanOrEqual(3);
    expect((await store.hit('k9', WINDOW_MS)).count).toBe(2);
  });
});

describe('createRedisStore', () => {
  it('takes the count and the time left from Redis', async () => {
    const redis: RedisLike = { eval: vi.fn(async () => [4, 123_000]) };
    const hit = await createRedisStore(redis, createMemoryStore()).hit('k', WINDOW_MS);
    expect(hit).toEqual({ count: 4, retryAfterMs: 123_000 });
  });

  it('falls back to the in-memory store when Redis errors, and still limits', async () => {
    const redis: RedisLike = { eval: vi.fn(async () => Promise.reject(new Error('down'))) };
    const app = appWith(
      createIpLimiter({
        name: 't',
        max: 2,
        windowMs: WINDOW_MS,
        store: createRedisStore(redis, createMemoryStore()),
      }),
    );
    expect((await from(app, '203.0.113.1')).status).toBe(200);
    expect((await from(app, '203.0.113.1')).status).toBe(200);
    expect((await from(app, '203.0.113.1')).status).toBe(429);
  });

  it('falls back when Redis hangs, instead of waiting for it', async () => {
    const redis: RedisLike = { eval: () => new Promise(() => undefined) };
    const store = createRedisStore(redis, createMemoryStore(), { timeoutMs: 20 });
    expect((await store.hit('k', WINDOW_MS)).count).toBe(1);
    expect((await store.hit('k', WINDOW_MS)).count).toBe(2);
  });

  it('falls back when Redis answers something unexpected', async () => {
    const redis: RedisLike = { eval: vi.fn(async () => 'nope') };
    const store = createRedisStore(redis, createMemoryStore());
    expect((await store.hit('k', WINDOW_MS)).count).toBe(1);
  });

  it('refuses the request (never lets it through) if the store itself throws', async () => {
    const app = appWith(
      createIpLimiter({
        name: 't',
        max: 5,
        windowMs: WINDOW_MS,
        store: { hit: async () => Promise.reject(new Error('broken')) },
      }),
    );
    expect((await from(app, '203.0.113.1')).status).toBe(429);
  });
});
