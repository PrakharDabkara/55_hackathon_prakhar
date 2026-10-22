import { Writable } from 'node:stream';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createLogger } from './logger.js';
import { createRealtime } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';
const SEEKER_PHONE = '9877001122';
const SHOP_PHONE = '9877003344';
const NOTE = 'gate pe dena, bell mat bajana';
const QUERY = 'chini';

// ADR-0060: what the request logger writes for a login and an order holds no phone, token, code,
// address, note or raw search text.
describe('what the logs hold (ADR-0060)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  const lines: string[] = [];
  const secrets: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createLogger('trace', sink);
    const app = createApp({
      config: testConfig(),
      logger,
      db: pool,
      realtime: createRealtime({ redisUrl: null, logger }),
    });
    const login = async (phone: string, role: 'seeker' | 'shop') => {
      await request(app).post('/auth/otp/request').send({ phone });
      const code = (await request(app).get('/dev/otp-inbox').query({ phone })).body.code as string;
      await request(app).post('/auth/otp/verify').send({ phone, code: '000000', role });
      const res = await request(app).post('/auth/otp/verify').send({ phone, code, role });
      secrets[`code-${role}`] = code;
      return res.body.token as string;
    };
    const seeker = await login(SEEKER_PHONE, 'seeker');
    const shop = await login(SHOP_PHONE, 'shop');
    secrets['token-seeker'] = seeker;
    secrets['token-shop'] = shop;
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const made = await request(app)
      .post('/shops')
      .set(auth(shop))
      .send({ name: 'Log Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    const shopId = made.body.id as string;
    await pool.query('DELETE FROM shop_stock');
    const req = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q: QUERY, lat: ORIGIN.lat, lng: ORIGIN.lng });
    await fanOutPings({ db: pool, logger, config: { maxPings: 10 } }, req.body.id, claimsAll);
    const pings = (await request(app).get('/shops/me/pings').set(auth(shop))).body;
    await request(app)
      .post(`/pings/${pings[0].id}/answer`)
      .set(auth(shop))
      .send({ answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } });
    const order = await request(app)
      .post('/orders')
      .set(auth(seeker))
      .send({ shopId, requestId: req.body.id, addressText: ADDRESS, note: NOTE });
    expect(order.status).toBe(201);
    await request(app).get('/orders').set(auth(seeker));
    await request(app)
      .get('/search')
      .query({ q: QUERY, lat: ORIGIN.lat, lng: ORIGIN.lng })
      .set(auth(seeker));
    await request(app).post('/auth/logout').set(auth(seeker));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  const all = () => lines.join('');

  it('logs the login and the order, with a request id on every request line', () => {
    expect(all()).toMatch(/otp requested/);
    expect(all()).toMatch(/"msg":"login"/);
    const completed = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === 'request completed');
    expect(completed.length).toBeGreaterThan(10);
    for (const line of completed) expect(line.req.id).toBeTruthy();
    expect(completed.some((l) => l.req.url === '/orders' && l.req.method === 'POST')).toBe(true);
  });

  it('holds no phone number, in any form', () => {
    for (const phone of [SEEKER_PHONE, SHOP_PHONE]) {
      expect(all()).not.toContain(phone);
      expect(all()).not.toContain(`+91${phone}`);
    }
  });

  it('holds no token and no one-time code', () => {
    for (const [name, value] of Object.entries(secrets)) {
      expect(all(), name).not.toContain(value);
    }
    expect(all()).not.toMatch(/authorization|bearer/i);
  });

  it('holds no address, order note or raw search text', () => {
    expect(all()).not.toContain('Sapna');
    expect(all()).not.toContain('Vijay Nagar');
    expect(all()).not.toContain(NOTE);
    expect(all()).not.toMatch(new RegExp(`"(q|query|text)":"${QUERY}`));
    // Query strings are cut from the URL, so /search?q=... is logged as /search.
    expect(all()).not.toMatch(/\?q=|[?&]phone=/);
  });
});
