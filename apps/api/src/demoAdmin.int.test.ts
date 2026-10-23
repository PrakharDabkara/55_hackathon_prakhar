import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { DEMO_SHOPS, DEMO_STOCK } from './modules/demo/fixtures.js';
import { createRequest, fanOutPings, type RequestsContext } from './modules/requests/index.js';
import { testConfig, TEST_ADMIN_TOKEN } from './testing/config.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const quiet = pino({ level: 'silent' });
const DEMO_PLACE = { lat: 22.7196, lng: 75.8577 };
const bearer = { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ADR-0062: the demo seed and reset. Admin-only, idempotent, and only ever about demo numbers.
describe('POST /admin/demo/seed and /admin/demo/reset', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let noAdminApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({
      config: testConfig({ adminToken: TEST_ADMIN_TOKEN }),
      logger: quiet,
      db: pool,
    });
    noAdminApp = createApp({ config: testConfig({ adminToken: null }), logger: quiet, db: pool });
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  const seed = () => request(app).post('/admin/demo/seed').set(bearer);
  const reset = () => request(app).post('/admin/demo/reset').set(bearer);
  const count = async (sql: string, args: unknown[] = []) =>
    Number((await pool.query<{ n: string }>(sql, args)).rows[0]?.n);
  /** Row counts of everything the seed writes, to compare before and after a second seed. */
  const snapshot = async () => ({
    users: await count(`SELECT count(*) AS n FROM users`),
    demoUsers: await count(`SELECT count(*) AS n FROM users WHERE is_demo`),
    shops: await count(`SELECT count(*) AS n FROM shops`),
    demoShops: await count(`SELECT count(*) AS n FROM shops WHERE is_demo`),
    simulated: await count(`SELECT count(*) AS n FROM shops WHERE is_demo AND is_simulated`),
    stock: await count(`SELECT count(*) AS n FROM shop_stock`),
    photos: await count(`SELECT count(*) AS n FROM photos`),
    addresses: await count(`SELECT count(*) AS n FROM saved_addresses`),
    ids: (await pool.query(`SELECT id FROM shops WHERE is_demo ORDER BY id`)).rows,
  });

  describe('access', () => {
    it.each(['/admin/demo/seed', '/admin/demo/reset'])(
      '%s is a plain 404 with no token, a wrong token, or no ADMIN_TOKEN on the server, and writes nothing',
      async (path) => {
        const before = await snapshot();
        for (const call of [
          request(app).post(path),
          request(app).post(path).set({ Authorization: 'Bearer wrong' }),
          request(app)
            .post(path)
            .set({ Authorization: `Bearer ${TEST_ADMIN_TOKEN}x` }),
          request(app).get(path).set(bearer),
          request(noAdminApp).post(path).set(bearer),
        ]) {
          const res = await call;
          expect(res.status).toBe(404);
          expect(res.body.error.code).toBe('not_found');
        }
        expect(await snapshot()).toEqual(before);
      },
    );
  });

  describe('seed', () => {
    it('makes five open demo shops on 9000000102 to 106, with logos, delivery and learned stock', async () => {
      const res = await seed();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ shops: 5, customers: 5, simulatedShops: 8, logos: 5 });
      expect(res.body.stockRows).toBe(DEMO_STOCK.length);

      const { rows } = await pool.query<Json>(
        `SELECT s.name, s.categories, s.is_demo, s.is_simulated, s.delivers_default,
                s.default_fee_paise, s.logo_photo_id, u.phone, u.role, u.is_demo AS user_demo,
                (s.closed_until IS NULL OR s.closed_until <= now()) AS open
           FROM shops s JOIN users u ON u.id = s.owner_user_id
          WHERE u.phone LIKE '+9190000001%' ORDER BY u.phone`,
      );
      expect(rows.map((r) => r['phone'])).toEqual(DEMO_SHOPS.map((s) => s.phone));
      for (const [i, row] of rows.entries()) {
        expect(row['name']).toBe(DEMO_SHOPS[i]?.name);
        expect(row['categories']).toEqual(DEMO_SHOPS[i]?.categories);
        expect(row).toMatchObject({
          is_demo: true,
          is_simulated: false,
          user_demo: true,
          role: 'shop',
          open: true,
        });
        expect(row['logo_photo_id']).not.toBeNull();
        expect(row['delivers_default']).toBe(Boolean(DEMO_SHOPS[i]?.delivery));
      }
      const fees = rows.filter((r) => r['delivers_default']).map((r) => r['default_fee_paise']);
      expect(fees.sort()).toEqual([2000, 3000]);
    });

    it('stocks the demo shops with fresh learned stock and makes the simulated shops', async () => {
      const stock = await pool.query<Json>(
        `SELECT st.price_paise, st.expires_at > now() AS fresh, st.source, i.slug, u.phone
           FROM shop_stock st JOIN shops s ON s.id = st.shop_id JOIN users u ON u.id = s.owner_user_id
           JOIN items i ON i.id = st.item_id
          WHERE u.phone LIKE '+9190000001%'`,
      );
      expect(stock.rows).toHaveLength(DEMO_STOCK.length);
      for (const row of stock.rows) {
        expect(row['fresh']).toBe(true);
        expect(row['source']).toBe('ping_yes');
      }
      const first = DEMO_STOCK[0];
      expect(
        stock.rows.find(
          (r) => r['slug'] === first?.slug && r['phone'] === DEMO_SHOPS[first?.shop ?? 0]?.phone,
        )?.price_paise,
      ).toBe(first?.pricePaise);

      const sims = await pool.query<Json>(
        `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS d
           FROM shops WHERE is_simulated AND is_demo`,
        [DEMO_PLACE.lat, DEMO_PLACE.lng],
      );
      expect(sims.rows).toHaveLength(8);
      for (const s of sims.rows) expect(s['d']).toBeLessThan(2000);
    });

    it('gives demo customers 9000000202 to 206 a clearly-demo saved address', async () => {
      const { rows } = await pool.query<Json>(
        `SELECT u.phone, u.role, u.is_demo, a.address_text
           FROM users u JOIN saved_addresses a ON a.user_id = u.id
          WHERE u.phone LIKE '+9190000002%' ORDER BY u.phone`,
      );
      expect(rows.map((r) => r['phone'])).toEqual([
        '+919000000202',
        '+919000000203',
        '+919000000204',
        '+919000000205',
        '+919000000206',
      ]);
      for (const r of rows) {
        expect(r).toMatchObject({ role: 'seeker', is_demo: true });
        expect(String(r['address_text']).toLowerCase()).toContain('demo');
      }
    });

    it('is idempotent: a second and a third seed change nothing and return the same counts', async () => {
      const first = await snapshot();
      const a = await seed();
      const b = await seed();
      expect(a.status).toBe(200);
      expect(b.body).toEqual(a.body);
      expect(await snapshot()).toEqual(first);
    });

    it('two seeds at once still make one set', async () => {
      const before = await snapshot();
      const [a, b] = await Promise.all([seed(), seed()]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await snapshot()).toEqual(before);
    });

    it('puts a demo number back as it should be: a name changed by hand, a stock row lost', async () => {
      await pool.query(`UPDATE shops SET name = 'Renamed', closed_until = now() + interval '1 day'
                         WHERE is_demo AND NOT is_simulated`);
      await pool.query(
        `DELETE FROM shop_stock WHERE shop_id IN (SELECT id FROM shops WHERE is_demo AND NOT is_simulated)`,
      );
      await seed();
      const shops = await pool.query<Json>(
        `SELECT name, (closed_until IS NULL OR closed_until <= now()) AS open
           FROM shops WHERE is_demo AND NOT is_simulated ORDER BY name`,
      );
      expect(shops.rows.every((r) => r['open'] === true)).toBe(true);
      expect(shops.rows.map((r) => r['name']).sort()).toEqual(DEMO_SHOPS.map((s) => s.name).sort());
      expect(
        await count(`SELECT count(*) AS n FROM shop_stock st JOIN shops s ON s.id = st.shop_id
                           WHERE s.is_demo AND NOT s.is_simulated`),
      ).toBe(DEMO_STOCK.length);
    });

    it('does not touch a real shop, a real user or a laptop-simulator shop', async () => {
      const real = await loginAs(app, 'shop', '9811100001');
      await pool.query(
        `INSERT INTO shops (owner_user_id, name, phone, categories, location)
         VALUES ($1, 'Real Kirana', '+919811100001', ARRAY['grocery'],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)`,
        [real.userId, DEMO_PLACE.lng, DEMO_PLACE.lat],
      );
      await pool.query(
        `INSERT INTO shops (name, phone, categories, location, is_simulated)
         VALUES ('Laptop Sim', '+916000000009', ARRAY['grocery'],
                 ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, true)`,
        [DEMO_PLACE.lng, DEMO_PLACE.lat],
      );
      const before = await pool.query(`SELECT * FROM shops WHERE NOT is_demo ORDER BY id`);
      await seed();
      await reset();
      const after = await pool.query(`SELECT * FROM shops WHERE NOT is_demo ORDER BY id`);
      expect(after.rows).toEqual(before.rows);
      expect(
        await count(`SELECT count(*) AS n FROM users WHERE id = $1 AND NOT is_demo`, [real.userId]),
      ).toBe(1);
    });
  });

  describe('reset', () => {
    /** Customer 202 (demo) and a real customer each have everything; the real shop is real. */
    async function populate() {
      const demoCustomer = await loginAs(app, 'seeker', '9000000202');
      const realCustomer = await loginAs(app, 'seeker', '9811100002');
      const realShop = (
        await pool.query<{ id: string }>(
          `SELECT s.id FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE u.phone = '+919811100001'`,
        )
      ).rows[0]?.id as string;
      const demoShop = (
        await pool.query<{ id: string }>(
          `SELECT s.id FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE u.phone = '+919000000103'`,
        )
      ).rows[0]?.id as string;
      const ctx: RequestsContext = {
        db: pool,
        logger: quiet,
        config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
      };
      const claims = { claim: async () => true, release: async () => undefined };
      const fan = { db: pool, logger: quiet, config: { maxPings: 10 } };

      const mine = await createRequest(ctx, demoCustomer.userId, { q: 'haldi', ...DEMO_PLACE });
      const theirs = await createRequest(ctx, realCustomer.userId, { q: 'haldi', ...DEMO_PLACE });
      await fanOutPings(fan, mine.request.id, claims);
      await fanOutPings(fan, theirs.request.id, claims);

      const list = async (token: string) =>
        (
          await request(app)
            .post('/lists/sort')
            .set({ Authorization: `Bearer ${token}` })
            .send({ lines: ['chini', 'pen'] })
        ).body.id as string;
      const demoList = await list(demoCustomer.token);
      const realList = await list(realCustomer.token);
      for (const [token, id] of [
        [demoCustomer.token, demoList],
        [realCustomer.token, realList],
      ] as const)
        await request(app)
          .post(`/lists/${id}/send`)
          .set({ Authorization: `Bearer ${token}` })
          .send(DEMO_PLACE);

      const errand = (userId: string) =>
        pool.query(
          `INSERT INTO errands (user_id, task, location) VALUES ($1, 'school things',
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)`,
          [userId, DEMO_PLACE.lng, DEMO_PLACE.lat],
        );
      await errand(demoCustomer.userId);
      await errand(realCustomer.userId);

      const order = (userId: string, shopId: string) =>
        pool.query(
          `INSERT INTO delivery_orders (user_id, shop_id, source_id, state, lines, expires_at, fulfilment)
           VALUES ($1, $2, gen_random_uuid(), 'ACCEPTED', '[]', now() + interval '1 hour', 'pickup')`,
          [userId, shopId],
        );
      await order(demoCustomer.userId, realShop); // a demo customer at a real shop
      await order(realCustomer.userId, demoShop); // a real customer at a demo shop
      await order(realCustomer.userId, realShop); // real at real: must stay

      // Tampered stock: an extra row at a demo shop, and a row at the real shop.
      const item = (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = 'pencil'`))
        .rows[0]?.id;
      for (const shopId of [demoShop, realShop])
        await pool.query(
          `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
           VALUES ($1, $2, 'ping_yes', 500, now(), now() + interval '7 days')
           ON CONFLICT DO NOTHING`,
          [shopId, item],
        );
      // Autopilot-learned stock at a simulated demo shop.
      const sim = (
        await pool.query<{ id: string }>(
          `SELECT id FROM shops WHERE is_demo AND is_simulated LIMIT 1`,
        )
      ).rows[0]?.id;
      await pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
         VALUES ($1, $2, 'ping_yes', 500, now(), now() + interval '7 days') ON CONFLICT DO NOTHING`,
        [sim, item],
      );
      return {
        demoCustomer,
        realCustomer,
        realShop,
        demoShop,
        mineId: mine.request.id,
        theirsId: theirs.request.id,
      };
    }

    const rowsOf = async (userId: string) => ({
      requests: await count(`SELECT count(*) AS n FROM requests WHERE user_id = $1`, [userId]),
      lists: await count(`SELECT count(*) AS n FROM shopping_lists WHERE user_id = $1`, [userId]),
      errands: await count(`SELECT count(*) AS n FROM errands WHERE user_id = $1`, [userId]),
      orders: await count(`SELECT count(*) AS n FROM delivery_orders WHERE user_id = $1`, [userId]),
    });

    it('removes what involves a demo number, keeps everything else, and returns counts only', async () => {
      await seed();
      const ctx = await populate();
      const realBefore = await rowsOf(ctx.realCustomer.userId);
      expect(realBefore).toEqual({ requests: 1, lists: 1, errands: 1, orders: 2 });
      const realPingsBefore = await count(
        `SELECT count(*) AS n FROM pings p JOIN shops s ON s.id = p.shop_id
           JOIN users u ON u.id = s.owner_user_id
          WHERE p.request_id = $1 AND u.phone NOT LIKE '+9190000001%'`,
        [ctx.theirsId],
      );
      expect(realPingsBefore).toBeGreaterThan(0);
      const realStockBefore = await count(
        `SELECT count(*) AS n FROM shop_stock WHERE shop_id = $1`,
        [ctx.realShop],
      );

      const res = await reset();
      expect(res.status).toBe(200);
      // Counts only: numbers, no ids, no phones, no names.
      const flat = JSON.stringify(res.body);
      expect(flat).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(flat).not.toContain('9000000');
      expect(res.body.removed).toMatchObject({ requests: 1, lists: 1, errands: 1, orders: 2 });
      expect(res.body.removed.pings).toBeGreaterThan(0);
      expect(res.body.seeded).toMatchObject({ shops: 5, customers: 5, simulatedShops: 8 });

      expect(await rowsOf(ctx.demoCustomer.userId)).toEqual({
        requests: 0,
        lists: 0,
        errands: 0,
        orders: 0,
      });
      // The real customer's request, list and errand stay; of two orders only the one at a real shop does.
      expect(await rowsOf(ctx.realCustomer.userId)).toEqual({
        requests: 1,
        lists: 1,
        errands: 1,
        orders: 1,
      });
      expect(
        await count(`SELECT count(*) AS n FROM delivery_orders WHERE shop_id = $1`, [ctx.demoShop]),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*) AS n FROM pings p JOIN shops s ON s.id = p.shop_id
             JOIN users u ON u.id = s.owner_user_id
            WHERE p.request_id = $1 AND u.phone NOT LIKE '+9190000001%'`,
          [ctx.theirsId],
        ),
      ).toBe(realPingsBefore);
      expect(
        await count(`SELECT count(*) AS n FROM pings p JOIN shops s ON s.id = p.shop_id
                           JOIN users u ON u.id = s.owner_user_id
                          WHERE u.phone LIKE '+9190000001%'`),
      ).toBe(0);
      expect(
        await count(`SELECT count(*) AS n FROM shop_stock WHERE shop_id = $1`, [ctx.realShop]),
      ).toBe(realStockBefore);
    });

    it('restores the seed state: fixture stock only at the demo shops, none learned at the simulated ones', async () => {
      expect(
        await count(`SELECT count(*) AS n FROM shop_stock st JOIN shops s ON s.id = st.shop_id
                      WHERE s.is_demo AND NOT s.is_simulated`),
      ).toBe(DEMO_STOCK.length);
      expect(
        await count(`SELECT count(*) AS n FROM shop_stock st JOIN shops s ON s.id = st.shop_id
                      WHERE s.is_demo AND s.is_simulated`),
      ).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM shops WHERE is_demo AND is_simulated`)).toBe(8);
    });

    it("keeps the demo logins working and finds nothing more of anyone's to remove the second time", async () => {
      const token = (await loginAs(app, 'seeker', '9000000203')).token;
      await reset();
      const again = await reset();
      // Nothing of a person's is left; the stock it clears is just the seed, put back at once.
      const { stockRows, ...people } = again.body.removed;
      expect(people).toEqual(Object.fromEntries(Object.keys(people).map((k) => [k, 0])));
      expect(stockRows).toBe(DEMO_STOCK.length);
      const me = await request(app)
        .get('/orders')
        .set({ Authorization: `Bearer ${token}` });
      expect(me.status).toBe(200);
    });

    it('treats only 101-110 and 201-210 as demo: 9000000111 and 9000000200 are left alone', async () => {
      const near = await loginAs(app, 'seeker', '9000000111');
      const edge = await loginAs(app, 'seeker', '9000000200');
      const ctx: RequestsContext = {
        db: pool,
        logger: quiet,
        config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
      };
      await createRequest(ctx, near.userId, { q: 'haldi', ...DEMO_PLACE });
      await createRequest(ctx, edge.userId, { q: 'haldi', ...DEMO_PLACE });
      await reset();
      expect(
        await count(`SELECT count(*) AS n FROM requests WHERE user_id = ANY($1::uuid[])`, [
          [near.userId, edge.userId],
        ]),
      ).toBe(2);
    });
  });
});
