import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// ADR-0035: "Aaj ki maang", worked out from the database alone, and aggregate when it is nearby.
describe('"Aaj ki maang" on the shop screen', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_892_000_000;
  type User = { token: string; userId: string };
  let owner: User;
  let rival: User;
  let customers: [User, User, User, User];
  let shopId: string;
  let slugs: Record<string, string>;
  const quiet = pino({ level: 'silent' });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const demand = (who: User = owner) => request(app).get('/shops/me/demand').set(auth(who));

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({
      config: testConfig(),
      logger: quiet,
      db: pool,
      realtime: createRealtime({ redisUrl: null, logger: quiet }),
    });
    owner = await loginAs(app, 'shop', String(phone++));
    rival = await loginAs(app, 'shop', String(phone++));
    customers = [
      await loginAs(app, 'seeker', String(phone++)),
      await loginAs(app, 'seeker', String(phone++)),
      await loginAs(app, 'seeker', String(phone++)),
      await loginAs(app, 'seeker', String(phone++)),
    ];
    shopId = (
      await request(app)
        .post('/shops')
        .set(auth(owner))
        .send({ name: 'Maang Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] })
    ).body.id as string;
    await request(app)
      .post('/shops')
      .set(auth(rival))
      .send({ name: 'Rival Hardware', lat: north(0.4), lng: ORIGIN.lng, categories: ['hardware'] });
    const items = await pool.query<{ id: string; slug: string; category: string }>(
      `SELECT id, slug, category FROM items`,
    );
    slugs = Object.fromEntries(items.rows.map((r) => [r.slug, r.id]));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE requests, pings CASCADE');
  });

  const groceries = async () =>
    (
      await pool.query<{ slug: string }>(
        `SELECT slug FROM items WHERE category = 'grocery' ORDER BY slug LIMIT 4`,
      )
    ).rows.map((r) => r.slug) as [string, string, string, string];
  const hardware = async () =>
    (
      await pool.query<{ slug: string }>(
        `SELECT slug FROM items WHERE category = 'hardware' ORDER BY slug LIMIT 2`,
      )
    ).rows.map((r) => r.slug) as [string, string];

  /** A customer's search for an item, `daysAgo` days back, from `km` north of the shop's street. */
  async function ask(who: User, slug: string, over: { daysAgo?: number; km?: number } = {}) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, expires_at, created_at)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 1000, 'EXPIRED',
               now() + interval '1 hour', now() - make_interval(days => $6::int))
       RETURNING id`,
      [who.userId, slugs[slug], slug, ORIGIN.lng, north(over.km ?? 0.3), over.daysAgo ?? 0],
    );
    return (rows[0] as { id: string }).id;
  }
  /** The ping that asking sent to a shop. */
  async function ping(requestId: string, slug: string, state: string, forShop = shopId) {
    await pool.query(
      `INSERT INTO pings (request_id, shop_id, item_id, state, sent_at, answered_at, created_at)
       SELECT $1, $2, $3, $4, now(), CASE WHEN $4 IN ('YES','NO') THEN now() END, r.created_at
         FROM requests r WHERE r.id = $1`,
      [requestId, forShop, slugs[slug], state],
    );
  }

  it('needs a shop login, and a shop', async () => {
    expect((await request(app).get('/shops/me/demand')).status).toBe(401);
    expect((await demand(customers[0])).status).toBe(403);
    const fresh = await loginAs(app, 'shop', String(phone++));
    expect((await demand(fresh)).status).toBe(404);
  });

  it('is zeros and empty lists on a quiet day', async () => {
    const res = await demand();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      today: { received: 0, answered: 0, yes: 0 },
      asked: [],
      nearby: [],
    });
  });

  describe('today: received, answered, said yes', () => {
    it("counts this shop's pings of today by what happened to them", async () => {
      const [a, b, c] = await groceries();
      await ping(await ask(customers[0], a), a, 'YES');
      await ping(await ask(customers[1], b), b, 'NO');
      await ping(await ask(customers[2], c), c, 'NO_REPLY');
      await ping(await ask(customers[3], a), a, 'SENT');
      const { today } = (await demand()).body;
      expect(today).toEqual({ received: 4, answered: 2, yes: 1 });
    });

    it("leaves out yesterday, other shops' pings and pings never sent", async () => {
      const [a] = await groceries();
      await ping(await ask(customers[0], a, { daysAgo: 2 }), a, 'YES');
      const rivalId = (
        (await pool.query<{ id: string }>(`SELECT id FROM shops WHERE name = 'Rival Hardware'`))
          .rows[0] as { id: string }
      ).id;
      await ping(await ask(customers[1], a), a, 'YES', rivalId);
      await ping(await ask(customers[2], a), a, 'QUEUED');
      expect((await demand()).body.today).toEqual({ received: 0, answered: 0, yes: 0 });
    });
  });

  describe('"Log ye pooch rahe the": asked of this shop, said no or never answered', () => {
    it('lists items by how often they were asked, with counts', async () => {
      const [a, b, c] = await groceries();
      await ping(await ask(customers[0], a), a, 'NO');
      await ping(await ask(customers[1], a), a, 'NO_REPLY');
      await ping(await ask(customers[2], a), a, 'NO');
      await ping(await ask(customers[0], b), b, 'NO_REPLY');
      await ping(await ask(customers[1], c), c, 'YES');
      const { asked } = (await demand()).body;
      expect(asked).toHaveLength(2);
      expect(asked[0]).toMatchObject({
        count: 3,
        item: { nameEn: expect.any(String), nameHi: expect.any(String) },
      });
      expect(asked[1]).toMatchObject({ count: 1 });
      // What it said yes to is not "asked for and missing".
      expect(JSON.stringify(asked)).not.toContain(c);
    });

    it('is only for today and only this shop', async () => {
      const [a] = await groceries();
      await ping(await ask(customers[0], a, { daysAgo: 1 }), a, 'NO');
      expect((await demand()).body.asked).toEqual([]);
    });

    it("is shown even for one customer: it is the shop's own ping, not a neighbourhood count", async () => {
      const [a] = await groceries();
      await ping(await ask(customers[0], a), a, 'NO_REPLY');
      expect((await demand()).body.asked).toHaveLength(1);
    });
  });

  describe('"Aas-paas ki maang": the area, in the shop\'s categories, three customers or more', () => {
    it('lists an item once three different customers asked for it today', async () => {
      const [a] = await groceries();
      for (const who of customers.slice(0, 3)) await ask(who, a);
      const { nearby } = (await demand()).body;
      expect(nearby).toHaveLength(1);
      expect(nearby[0]).toMatchObject({ customers: 3, item: { nameEn: expect.any(String) } });
    });

    it('holds back an item that only two customers asked for', async () => {
      const [a] = await groceries();
      for (const who of customers.slice(0, 2)) await ask(who, a);
      expect((await demand()).body.nearby).toEqual([]);
    });

    it('counts customers, not searches: one person asking five times is one', async () => {
      const [a] = await groceries();
      for (let i = 0; i < 5; i++) await ask(customers[0], a);
      await ask(customers[1], a);
      await ask(customers[1], a);
      expect((await demand()).body.nearby).toEqual([]);
      await ask(customers[2], a);
      expect((await demand()).body.nearby[0].customers).toBe(3);
    });

    it("stays in the shop's categories", async () => {
      const [nail] = await hardware();
      for (const who of customers.slice(0, 3)) await ask(who, nail);
      expect((await demand()).body.nearby).toEqual([]);
      expect((await demand(rival)).body.nearby).toHaveLength(1);
    });

    it("stays in the shop's area and in today", async () => {
      const [a, b] = await groceries();
      for (const who of customers.slice(0, 3)) await ask(who, a, { km: 40 });
      for (const who of customers.slice(0, 3)) await ask(who, b, { daysAgo: 1 });
      expect((await demand()).body.nearby).toEqual([]);
    });

    it('works even if the shop was never pinged for it', async () => {
      const [a] = await groceries();
      for (const who of customers.slice(0, 3)) await ask(who, a);
      const res = await demand();
      expect(res.body.today.received).toBe(0);
      expect(res.body.nearby).toHaveLength(1);
    });
  });

  describe('privacy', () => {
    it('never carries a customer, a phone or a place, only item names and counts', async () => {
      const [a, b] = await groceries();
      for (const who of customers.slice(0, 3)) {
        const id = await ask(who, a);
        await ping(id, a, 'NO');
      }
      await ping(await ask(customers[3], b), b, 'NO_REPLY');
      const res = await demand();
      const text = JSON.stringify(res.body);
      for (const who of customers) expect(text).not.toContain(who.userId);
      expect(text).not.toMatch(/9892\d{6}/);
      expect(text).not.toMatch(/lat|lng|location|phone|user/i);
      // Every leaf is a number, or an item's names.
      for (const row of [...res.body.asked, ...res.body.nearby])
        expect(Object.keys(row).sort()).toEqual(
          row.customers === undefined ? ['count', 'item'] : ['customers', 'item'],
        );
    });

    it('never shows an area count below 3 however it is asked for', async () => {
      const [a] = await groceries();
      await ask(customers[0], a);
      await ask(customers[1], a);
      for (let n = 0; n < 3; n++) expect((await demand()).body.nearby).toEqual([]);
    });
  });
});
