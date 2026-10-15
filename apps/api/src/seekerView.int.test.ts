import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { testConfig } from './testing/config.js';
import { insertShopWithStock, north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { startRedis } from './testing/startRedis.js';
import { waitFor } from './testing/waitFor.js';
import { startWorkers, type Workers } from './workers/index.js';

type User = { token: string; userId: string };
const logger = pino({ level: 'silent' });

describe('what the seeker sees: shop positions and ping counts', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let workers: Workers;
  let app: ReturnType<typeof createApp>;
  let phone = 9_880_000_000;
  const seekerLoc = { lat: ORIGIN.lat + 0.0123, lng: ORIGIN.lng + 0.0456 };

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const config = testConfig({ workersEnabled: true, redisUrl: redis.url });
    workers = startWorkers({ config, db: pool, logger }) as Workers;
    app = createApp({ config, logger, db: pool, requestHooks: workers.hooks });
  }, 300_000);

  afterAll(async () => {
    await workers?.close();
    await testDb?.stop();
    await redis?.stop();
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const itemId = async (slug: string) =>
    (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = $1`, [slug])).rows[0]
      ?.id as string;

  it('gives every result its shop lat and lng, for learned stock', async () => {
    const wheat = await itemId('wheat-flour');
    const shopId = await insertShopWithStock(pool, {
      name: 'Learned Kirana',
      km: 0.5,
      itemId: wheat,
      ageHours: 2,
    });
    const seeker = await loginAs(app, 'seeker', String(phone++));
    const res = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q: 'aata', lat: ORIGIN.lat, lng: ORIGIN.lng });
    const row = res.body.results.find((r: { shopId: string }) => r.shopId === shopId);
    expect(row.lat).toBeCloseTo(north(0.5), 5);
    expect(row.lng).toBeCloseTo(ORIGIN.lng, 5);
    await request(app).post(`/requests/${res.body.id}/close`).set(auth(seeker));
  });

  it('gives live answers a position too, and never shows shops where the seeker is', async () => {
    const shop = await loginAs(app, 'shop', String(phone++));
    await request(app)
      .post('/shops')
      .set(auth(shop))
      .send({ name: 'Live Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    const seeker = await loginAs(app, 'seeker', String(phone++));
    const asked = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q: 'chini', lat: seekerLoc.lat, lng: seekerLoc.lng, radiusM: 5000 });
    expect(asked.body.state).toBe('PINGING');

    const pings = await waitFor(
      async () => (await request(app).get('/shops/me/pings').set(auth(shop))).body,
      (b) => b.length > 0,
    );
    // What the shop sees about the asker: a distance band, never a position.
    const text = JSON.stringify(pings);
    expect(text).not.toContain(String(seekerLoc.lat).slice(0, 7));
    expect(text).not.toContain(String(seekerLoc.lng).slice(0, 7));
    expect(Object.keys(pings[0])).not.toContain('lat');
    expect(Object.keys(pings[0])).not.toContain('lng');

    await request(app)
      .post(`/pings/${pings[0].id}/answer`)
      .set(auth(shop))
      .send({ answer: 'yes', pricePaise: 4800 });
    const view = await request(app).get(`/requests/${asked.body.id}`).set(auth(seeker));
    const live = view.body.results.find((r: { source: string }) => r.source === 'live');
    expect(live.lat).toBeCloseTo(north(0.3), 5);
    expect(live.lng).toBeCloseTo(ORIGIN.lng, 5);
    // The seeker's own point is not part of the response at all.
    expect(JSON.stringify(view.body)).not.toContain(String(seekerLoc.lat).slice(0, 7));
  });

  describe('pingStats', () => {
    it('counts sent, yes, no and pending pings of this request', async () => {
      const shops: User[] = [];
      for (const [i, name] of ['S One', 'S Two', 'S Three'].entries()) {
        const u = await loginAs(app, 'shop', String(phone++));
        await request(app)
          .post('/shops')
          .set(auth(u))
          .send({ name, lat: north(2.5 + i * 0.1), lng: ORIGIN.lng, categories: ['hardware'] });
        shops.push(u);
      }
      const seeker = await loginAs(app, 'seeker', String(phone++));
      const asked = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q: 'hammer', lat: north(2.5), lng: ORIGIN.lng, radiusM: 1000 });
      expect(asked.body.pingStats).toEqual({ sent: 0, yes: 0, no: 0, pending: 0 });

      const stats = async () =>
        (await request(app).get(`/requests/${asked.body.id}`).set(auth(seeker))).body.pingStats;
      await waitFor(stats, (s) => s.sent === 3);
      expect(await stats()).toEqual({ sent: 3, yes: 0, no: 0, pending: 3 });

      const first = await request(app)
        .get('/shops/me/pings')
        .set(auth(shops[0] as User));
      const second = await request(app)
        .get('/shops/me/pings')
        .set(auth(shops[1] as User));
      await request(app)
        .post(`/pings/${second.body[0].id}/answer`)
        .set(auth(shops[1] as User))
        .send({ answer: 'no' });
      expect(await stats()).toEqual({ sent: 3, yes: 0, no: 1, pending: 2 });
      await request(app)
        .post(`/pings/${first.body[0].id}/answer`)
        .set(auth(shops[0] as User))
        .send({ answer: 'yes', pricePaise: 25000 });
      // The yes answers the request, which ends the wait for the third shop.
      expect(await stats()).toEqual({ sent: 3, yes: 1, no: 1, pending: 0 });
    });

    it('is all zeros for a request answered from learned stock', async () => {
      const wheat = await itemId('rice');
      for (let i = 0; i < 3; i++) {
        await insertShopWithStock(pool, {
          name: `Rice ${i}`,
          km: 0.1 * (i + 1),
          itemId: wheat,
          ageHours: 1,
        });
      }
      const seeker = await loginAs(app, 'seeker', String(phone++));
      const res = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q: 'chawal', lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(res.body.state).toBe('ANSWERED');
      expect(res.body.pingStats).toEqual({ sent: 0, yes: 0, no: 0, pending: 0 });
    });
  });
});
