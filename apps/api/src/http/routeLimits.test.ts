import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './errors.js';
import { createMemoryStore, type IpLimitStore } from './ipLimit.js';
import { createRouteLimits, ROUTE_RULES, type RouteRule } from './routeLimits.js';
import { pino } from 'pino';

const WINDOW = 60_000;

function build(rules: RouteRule[], store: IpLimitStore = createMemoryStore()) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    createRouteLimits({
      rules,
      store,
      // The "user" is whatever the test says; no token means nobody.
      identify: async (req) => req.header('x-user') ?? null,
    }),
  );
  app.all('/{*any}', (_req, res) => void res.json({ ok: true }));
  app.use(errorHandler(pino({ level: 'silent' })));
  return app;
}
const as = (user: string, ip = '1.1.1.1') => ({ 'x-user': user, 'x-forwarded-for': ip });

describe('route limits (SEC2)', () => {
  const rule: RouteRule = {
    method: 'GET',
    path: '/search',
    name: 'search',
    perUser: 3,
    perIp: 5,
    windowMs: WINDOW,
  };

  it('answers 429 with Retry-After once one user passes the per-user limit', async () => {
    const app = build([rule]);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/search').set(as('u1'))).status).toBe(200);
    }
    const res = await request(app).get('/search').set(as('u1'));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('counts each user on their own: one noisy user does not lock out another on another address', async () => {
    const app = build([rule]);
    for (let i = 0; i < 4; i++) await request(app).get('/search').set(as('u1', '1.1.1.1'));
    expect((await request(app).get('/search').set(as('u2', '2.2.2.2'))).status).toBe(200);
  });

  it('counts each address on its own across users (per IP)', async () => {
    const app = build([rule]);
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(app)
            .get('/search')
            .set(as(`u${i}`, '9.9.9.9'))
        ).status,
      ).toBe(200);
    }
    const res = await request(app).get('/search').set(as('u-new', '9.9.9.9'));
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect((await request(app).get('/search').set(as('u-new', '8.8.8.8'))).status).toBe(200);
  });

  it('limits by address alone when nobody is signed in', async () => {
    const app = build([rule]);
    const anon = { 'x-forwarded-for': '7.7.7.7' };
    for (let i = 0; i < 5; i++) await request(app).get('/search').set(anon);
    expect((await request(app).get('/search').set(anon)).status).toBe(429);
  });

  it('a rule with no per-IP number only counts users, and one with no per-user only addresses', async () => {
    const app = build([
      { method: 'POST', path: '/lists/sort', name: 'sort', perUser: 2, windowMs: WINDOW },
      { method: 'POST', path: '/photos', name: 'photos', perIp: 2, windowMs: WINDOW },
    ]);
    for (let i = 0; i < 2; i++)
      await request(app)
        .post('/lists/sort')
        .set(as('u1', `3.3.3.${i}`));
    expect((await request(app).post('/lists/sort').set(as('u1', '3.3.3.9'))).status).toBe(429);
    for (let i = 0; i < 2; i++)
      await request(app)
        .post('/photos')
        .set(as(`u${i}`, '4.4.4.4'));
    expect((await request(app).post('/photos').set(as('u9', '4.4.4.4'))).status).toBe(429);
  });

  it('only touches its own method and path', async () => {
    const app = build([rule]);
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/search').set(as('u1'))).status).toBe(200);
      expect((await request(app).get('/search/other').set(as('u1'))).status).toBe(200);
      expect((await request(app).get('/health').set(as('u1'))).status).toBe(200);
    }
  });

  it('cannot be skipped by spelling the path differently (Express matches /SEARCH and /search/)', async () => {
    const app = build([rule]);
    for (const path of ['/search', '/SEARCH', '/search/', '/Search/']) {
      await request(app).get(path).set(as('u1'));
    }
    expect((await request(app).get('/sEaRcH').set(as('u1'))).status).toBe(429);
  });

  it('starts a fresh window when the old one ends', async () => {
    let now = 1_000_000;
    const app = build([rule], createMemoryStore({ now: () => now }));
    for (let i = 0; i < 4; i++) await request(app).get('/search').set(as('u1'));
    expect((await request(app).get('/search').set(as('u1'))).status).toBe(429);
    now += WINDOW + 1;
    expect((await request(app).get('/search').set(as('u1'))).status).toBe(200);
  });

  it('never fails open: a broken store refuses the request', async () => {
    const broken: IpLimitStore = {
      hit: async () => {
        throw new Error('store is gone');
      },
    };
    const res = await request(build([rule], broken))
      .get('/search')
      .set(as('u1'));
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('refuses when only the user counter breaks', async () => {
    const real = createMemoryStore();
    const flaky: IpLimitStore = {
      hit: async (key, windowMs) => {
        if (key.includes(':u:')) throw new Error('boom');
        return real.hit(key, windowMs);
      },
    };
    expect(
      (
        await request(build([rule], flaky))
          .get('/search')
          .set(as('u1'))
      ).status,
    ).toBe(429);
  });

  it('does not count a request twice when it matches no rule', async () => {
    const store = createMemoryStore();
    const app = build([rule], store);
    await request(app).get('/other').set(as('u1'));
    expect(store.size()).toBe(0);
  });
});

describe('the rules the API ships with (SEC2)', () => {
  const find = (method: string, path: string) =>
    ROUTE_RULES.find((r) => r.method === method && r.path === path);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  it.each([
    ['GET', '/search', 30, 60, MINUTE],
    ['POST', '/items/resolve', 30, 60, MINUTE],
    ['POST', '/lists/sort', 10, undefined, MINUTE],
    ['POST', '/route/plan', 20, undefined, MINUTE],
    ['POST', '/requests', 20, undefined, HOUR],
    ['POST', '/photos', 20, undefined, HOUR],
  ])('%s %s: %s per user, %s per IP', (method, path, perUser, perIp, windowMs) => {
    expect(find(method, path)).toMatchObject({ perUser, perIp, windowMs });
  });
});
