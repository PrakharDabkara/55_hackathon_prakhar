import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });

// The endpoints the MCP tools rely on, beyond what the earlier days already test.
describe('API support for the MCP tools', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let seeker: { token: string };
  let sugarId = '';

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({ config: testConfig(), logger, db: pool });
    seeker = await loginAs(app, 'seeker', '9871000001');
    sugarId = (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = 'sugar'`))
      .rows[0]?.id as string;
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const auth = () => ({ Authorization: `Bearer ${seeker.token}` });

  describe('an item id is enough: the text is optional when it is given', () => {
    it('GET /search?itemId=… with no q', async () => {
      const res = await request(app)
        .get('/search')
        .set(auth())
        .query({ itemId: sugarId, lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(res.status).toBe(200);
      expect(res.body.item.slug).toBe('sugar');
    });

    it('POST /requests with itemId and no q', async () => {
      const res = await request(app)
        .post('/requests')
        .set(auth())
        .send({ itemId: sugarId, lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(res.status).toBe(201);
      expect(res.body.item.slug).toBe('sugar');
      await request(app).post(`/requests/${res.body.id}/close`).set(auth());
    });

    it('still needs one of them', async () => {
      const search = await request(app)
        .get('/search')
        .set(auth())
        .query({ lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(search.status).toBe(400);
      const create = await request(app)
        .post('/requests')
        .set(auth())
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(create.status).toBe(400);
    });
  });

  describe('POST /route/plan', () => {
    const north = (km: number) => ORIGIN.lat + km / 111.195;
    const body = {
      start: { lat: ORIGIN.lat, lng: ORIGIN.lng },
      stops: [
        { shopId: 'b', lat: north(2), lng: ORIGIN.lng, label: 'Far' },
        { shopId: 'a', lat: north(1), lng: ORIGIN.lng, label: 'Near' },
      ],
    };

    it('needs a login', async () => {
      expect((await request(app).post('/route/plan').send(body)).status).toBe(401);
    });

    it('orders the stops and gives the legs and the total', async () => {
      const res = await request(app).post('/route/plan').set(auth()).send(body);
      expect(res.status).toBe(200);
      expect(res.body.orderedStops.map((s: { shopId: string }) => s.shopId)).toEqual(['a', 'b']);
      expect(res.body.legsM).toHaveLength(2);
      expect(res.body.totalM).toBeCloseTo(2000, -1);
    });

    it('rejects no stops, more than 8, and bad coordinates with a 400', async () => {
      const nine = Array.from({ length: 9 }, (_, i) => ({
        shopId: `s${i}`,
        lat: north(i / 10),
        lng: ORIGIN.lng,
        label: `S${i}`,
      }));
      for (const bad of [
        { ...body, stops: [] },
        { ...body, stops: nine },
        { ...body, start: { lat: 200, lng: 0 } },
      ]) {
        const res = await request(app).post('/route/plan').set(auth()).send(bad);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      }
    });
  });
});
