import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime, type Realtime } from './modules/realtime/index.js';
import { testConfig, TEST_ADMIN_TOKEN } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { openSse, type SseStream } from './testing/sseClient.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { startRedis } from './testing/startRedis.js';
import { waitFor } from './testing/waitFor.js';
import { startWorkers, type Workers } from './workers/index.js';

const quiet = pino({ level: 'silent' });

type User = { token: string; userId: string; role: string };

describe('admin token and the simulator endpoints', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let realtime: Realtime;
  let workers: Workers;
  let app: ReturnType<typeof createApp>; // ADMIN_TOKEN is set
  let closedApp: ReturnType<typeof createApp>; // ADMIN_TOKEN is not set
  let server: Server;
  let base: string;
  let admin: User;
  let seeker: User;
  let shop: User;
  let phone = 9_860_000_000;
  const streams: SseStream[] = [];

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());

    const config = testConfig({
      workersEnabled: true,
      redisUrl: redis.url,
      adminToken: TEST_ADMIN_TOKEN,
    });
    realtime = createRealtime({ redisUrl: redis.url, logger: quiet, heartbeatMs: 100 });
    workers = startWorkers({ config, db: pool, logger: quiet, events: realtime.events }) as Workers;
    app = createApp({ config, logger: quiet, db: pool, requestHooks: workers.hooks, realtime });
    closedApp = createApp({
      config: testConfig({ redisUrl: redis.url, adminToken: null }),
      logger: quiet,
      db: pool,
      realtime,
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    admin = { token: TEST_ADMIN_TOKEN, userId: 'admin', role: 'admin' };
    seeker = await loginAs(app, 'seeker', String(phone++));
    shop = await loginAs(app, 'shop', String(phone++));
  }, 300_000);

  afterAll(async () => {
    for (const s of streams) s.close();
    server?.closeAllConnections();
    await workers?.close();
    await realtime?.close();
    await testDb?.stop();
    await redis?.stop();
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const body = { count: 5, centre: ORIGIN, radiusM: 1500, seed: 7 };
  const create = (b: unknown = body, who: User | null = admin, target = app) => {
    const req = request(target).post('/admin/sim/shops');
    return (who ? req.set(auth(who)) : req).send(b as object);
  };
  const wipe = (who: User | null = admin, target = app) => {
    const req = request(target).delete('/admin/sim/shops');
    return who ? req.set(auth(who)) : req;
  };
  const simulatedCount = async () =>
    (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM shops WHERE is_simulated`))
      .rows[0]?.n;

  describe('migration 007', () => {
    it('adds items.ref_price_paise (filled by the seed) and shops.is_simulated (false by default)', async () => {
      const missing = await pool.query(`SELECT slug FROM items WHERE ref_price_paise IS NULL`);
      expect(missing.rows).toEqual([]);
      const { rows } = await pool.query<{ ref_price_paise: number }>(
        `SELECT ref_price_paise FROM items WHERE slug = 'matchbox'`,
      );
      expect(rows[0]?.ref_price_paise).toBeGreaterThan(0);

      const real = await request(app)
        .post('/shops')
        .set(auth(shop))
        .send({ name: 'Real Kirana', lat: north(0.2), lng: ORIGIN.lng, categories: ['grocery'] });
      expect(real.status).toBe(201);
      const flag = await pool.query<{ is_simulated: boolean }>(
        `SELECT is_simulated FROM shops WHERE id = $1`,
        [real.body.id],
      );
      expect(flag.rows[0]?.is_simulated).toBe(false);
    });

    it('re-seeding updates a changed reference price', async () => {
      const catalog = loadSeedCatalog();
      const changed = {
        ...catalog,
        items: catalog.items.map((i) => (i.slug === 'matchbox' ? { ...i, refPricePaise: 300 } : i)),
      };
      await seedCatalog(pool, changed);
      const { rows } = await pool.query(
        `SELECT ref_price_paise FROM items WHERE slug = 'matchbox'`,
      );
      expect(rows[0].ref_price_paise).toBe(300);
      await seedCatalog(pool, catalog);
    });
  });

  describe('phone login never makes an admin', () => {
    it('gives a seeker or a shop the role it asked for', () => {
      expect(seeker.role).toBe('seeker');
      expect(shop.role).toBe('shop');
    });

    it('does not make a phone an admin however it is named, with ADMIN_TOKEN set', async () => {
      const user = await loginAs(app, 'shop', String(phone++));
      expect(user.role).toBe('shop');
      expect((await create(body, user)).status).toBe(404);
    });
  });

  describe('admin endpoints are invisible to everyone else', () => {
    const wrongCallers = (): [string, User | null][] => [
      ['an anonymous caller', null],
      ['a seeker', seeker],
      ['a shop', shop],
      ['a wrong token', { token: `${TEST_ADMIN_TOKEN}x`, userId: '', role: 'admin' }],
      [
        'a token of the right length',
        { token: 'y'.repeat(TEST_ADMIN_TOKEN.length), userId: '', role: 'admin' },
      ],
      ['a short token', { token: TEST_ADMIN_TOKEN.slice(0, 10), userId: '', role: 'admin' }],
    ];

    it.each(['create', 'delete', 'ticket', 'events'])(
      '%s: 404 for anyone without the token',
      async (what) => {
        for (const [label, who] of wrongCallers()) {
          const res =
            what === 'create'
              ? await create(body, who)
              : what === 'delete'
                ? await wipe(who)
                : what === 'ticket'
                  ? await (who
                      ? request(app).post('/admin/sim/ticket').set(auth(who))
                      : request(app).post('/admin/sim/ticket'))
                  : await request(app).get('/admin/sim/events').query({ ticket: 'x' });
          expect(res.status, `${what} as ${label}`).toBe(404);
          expect(res.body.error.code).toBe('not_found');
        }
        expect(await simulatedCount()).toBe(0);
      },
    );

    it('answers 404, not 401 or 403, so the endpoints do not reveal themselves', async () => {
      // Same body but for the ref, which is per request.
      const sameBut = (res: { body: { error: object } }) => ({ ...res.body.error, requestId: 'x' });
      expect(sameBut(await create(body, seeker))).toEqual(
        sameBut(await request(app).get('/no/such/route')),
      );
    });

    it('answers with the right token', async () => {
      const res = await create({ ...body, count: 2 });
      expect(res.status).toBe(201);
      expect((await wipe()).status).toBe(200);
    });

    it('fails closed: with ADMIN_TOKEN unset, even the usual token gets 404 everywhere', async () => {
      expect((await create(body, admin, closedApp)).status).toBe(404);
      expect((await wipe(admin, closedApp)).status).toBe(404);
      expect((await request(closedApp).post('/admin/sim/ticket').set(auth(admin))).status).toBe(
        404,
      );
      expect(
        (await request(closedApp).get('/admin/sim/events').query({ ticket: 'x' })).status,
      ).toBe(404);
      expect(await simulatedCount()).toBe(0);
    });

    it('other admin routes check the same token', async () => {
      for (const route of ['/admin/ai/stats', '/admin/errands/stats']) {
        expect((await request(app).get(route)).status, route).toBe(404);
        expect((await request(app).get(route).set(auth(seeker))).status, route).toBe(404);
        expect(
          (
            await request(app)
              .get(route)
              .set(auth({ token: `${TEST_ADMIN_TOKEN}x` }))
          ).status,
          route,
        ).toBe(404);
        expect((await request(app).get(route).set(auth(admin))).status, route).toBe(200);
        expect((await request(closedApp).get(route).set(auth(admin))).status, route).toBe(404);
      }
    });
  });

  describe('POST /admin/sim/shops', () => {
    it.each([
      ['no count', { ...body, count: undefined }],
      ['count 0', { ...body, count: 0 }],
      ['count 501', { ...body, count: 501 }],
      ['a fractional count', { ...body, count: 2.5 }],
      ['no centre', { ...body, centre: undefined }],
      ['a latitude out of range', { ...body, centre: { lat: 91, lng: 75 } }],
      ['no radius', { ...body, radiusM: undefined }],
      ['a negative radius', { ...body, radiusM: -5 }],
      ['no seed', { ...body, seed: undefined }],
      ['a text seed', { ...body, seed: 'abc' }],
      ['an empty category list', { ...body, categories: [] }],
      ['an unknown category', { ...body, categories: ['jewellery'] }],
    ])('refuses %s with 400', async (_name, bad) => {
      const res = await create(bad);
      expect(res.status).toBe(400);
      expect(await simulatedCount()).toBe(0);
    });

    it('creates simulated users and shops on the server and returns each shop id with a working token', async () => {
      const res = await create({ ...body, count: 25 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(25);
      for (const s of res.body) expect(Object.keys(s).sort()).toEqual(['shopId', 'token']);

      const first = res.body[0] as { shopId: string; token: string };
      const mine = await request(app)
        .get('/shops/me')
        .set(auth({ token: first.token }));
      expect(mine.status).toBe(200);
      expect(mine.body.id).toBe(first.shopId);

      const { rows } = await pool.query(
        `SELECT s.is_simulated, u.role, s.categories,
                ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
           FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE s.is_simulated`,
        [ORIGIN.lng, ORIGIN.lat],
      );
      expect(rows).toHaveLength(25);
      for (const r of rows) {
        expect(r.role).toBe('shop');
        expect(r.metres).toBeLessThanOrEqual(1501);
        expect(r.categories.length).toBeGreaterThanOrEqual(1);
      }
      await wipe();
    });

    it('can be limited to some categories, so a demo can have grocery shops only', async () => {
      const res = await create({ ...body, count: 8, categories: ['grocery'] });
      expect(res.status).toBe(201);
      const { rows } = await pool.query(`SELECT categories FROM shops WHERE is_simulated`);
      expect(rows).toHaveLength(8);
      for (const r of rows) expect(r.categories).toEqual(['grocery']);
      await wipe();
    });

    it('can be called again with the same seed without clashing', async () => {
      expect((await create({ ...body, count: 10 })).status).toBe(201);
      expect((await create({ ...body, count: 10 })).status).toBe(201);
      expect(await simulatedCount()).toBe(20);
      await wipe();
    });
  });

  describe('DELETE /admin/sim/shops', () => {
    it('removes simulated shops with their users, sessions, pings and stock, and nothing real', async () => {
      const realShop = await request(app)
        .post('/shops')
        .set(auth(await loginAs(app, 'shop', String(phone++))))
        .send({ name: 'Survivor', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
      const made = await create({ ...body, count: 6 });
      const ids = (made.body as { shopId: string }[]).map((s) => s.shopId);
      const item = (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = 'rice'`))
        .rows[0]?.id;
      await pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, last_confirmed_at, expires_at)
         SELECT unnest($1::uuid[]), $2, 'ping_yes', now(), now() + interval '7 days'`,
        [ids, item],
      );
      const asked = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q: 'chawal', lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(asked.status).toBe(201);
      await waitFor(
        async () =>
          (await pool.query(`SELECT 1 FROM pings WHERE shop_id = ANY($1)`, [ids])).rowCount,
        (n) => (n ?? 0) > 0,
      );

      const res = await wipe();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ shops: 6, users: 6 });

      const count = async (sql: string) =>
        ((await pool.query(sql, [ids])).rows[0] as { n: number }).n;
      expect(await simulatedCount()).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM shop_stock WHERE shop_id = ANY($1)`)).toBe(
        0,
      );
      expect(await count(`SELECT count(*)::int AS n FROM pings WHERE shop_id = ANY($1)`)).toBe(0);
      const users = await pool.query(`SELECT 1 FROM users WHERE phone LIKE '+9160%'`);
      expect(users.rowCount).toBe(0);
      const sessions = await pool.query(
        `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.phone LIKE '+9160%'`,
      );
      expect(sessions.rowCount).toBe(0);
      expect(realShop.status).toBe(201);
      const real = await pool.query(`SELECT 1 FROM shops WHERE name = 'Survivor'`);
      expect(real.rowCount).toBe(1);
      await request(app).post(`/requests/${asked.body.id}/close`).set(auth(seeker));
    }, 30_000);

    it('removes list pings, answered list lines and list orders (delivery and pickup) of simulated shops, and leaves a real shop list data alone', async () => {
      const realShop = await request(app)
        .post('/shops')
        .set(auth(await loginAs(app, 'shop', String(phone++))))
        .send({ name: 'List Survivor', lat: north(0.4), lng: ORIGIN.lng, categories: ['grocery'] });
      expect(realShop.status).toBe(201);
      const made = await create({ ...body, count: 4 });
      const sim = (made.body as { shopId: string }[]).map((s) => s.shopId);
      const item = (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = 'rice'`))
        .rows[0]?.id;
      const list = (
        await pool.query<{ id: string; user_id: string }>(
          `INSERT INTO shopping_lists (user_id, state, location, radius_m, expires_at, sent_at)
           VALUES ($3, 'OPEN', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 2000,
                   now() + interval '15 minutes', now())
           RETURNING id, user_id`,
          [ORIGIN.lng, ORIGIN.lat, seeker.userId],
        )
      ).rows[0] as { id: string; user_id: string };
      const line = (
        await pool.query<{ id: string }>(
          `INSERT INTO list_lines (list_id, position, text, status, item_id)
           VALUES ($1, 0, 'rice', 'item', $2) RETURNING id`,
          [list.id, item],
        )
      ).rows[0]?.id;
      const all = [...sim, realShop.body.id as string];
      const pings = await pool.query<{ id: string; shop_id: string }>(
        `INSERT INTO list_pings (list_id, shop_id, state, answered_at, can_deliver, delivery_fee_paise)
         SELECT $1, s, 'ANSWERED', now(), true, 2000 FROM unnest($2::uuid[]) s
         RETURNING id, shop_id`,
        [list.id, all],
      );
      await pool.query(
        `INSERT INTO list_ping_lines (list_ping_id, line_id, have, price_paise)
         SELECT unnest($1::uuid[]), $2, true, 5000`,
        [pings.rows.map((p) => p.id), line],
      );
      // A delivery order and a pickup order from this list on simulated shops; a delivery order
      // on the real shop.
      const order = (shopId: string, fulfilment: 'delivery' | 'pickup', state: string) =>
        pool.query(
          `INSERT INTO delivery_orders
             (user_id, shop_id, list_id, source_id, state, lines, fulfilment, address_text, lat, lng,
              expires_at)
           VALUES ($1, $2, $3, $3, $4, '[]'::jsonb, $5, $6, $7, $8, now() + interval '1 hour')`,
          [
            list.user_id,
            shopId,
            list.id,
            state,
            fulfilment,
            fulfilment === 'delivery' ? 'Flat 4B, Sapna Apartments' : null,
            fulfilment === 'delivery' ? ORIGIN.lat : null,
            fulfilment === 'delivery' ? ORIGIN.lng : null,
          ],
        );
      await order(sim[0] as string, 'delivery', 'ACCEPTED');
      await order(sim[1] as string, 'pickup', 'READY');
      await order(sim[2] as string, 'pickup', 'REQUESTED');
      await order(realShop.body.id, 'delivery', 'REQUESTED');

      const res = await wipe();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ shops: 4, users: 4 });

      const n = async (sql: string, args: unknown[]) =>
        ((await pool.query(sql, args)).rows[0] as { n: number }).n;
      expect(
        await n(`SELECT count(*)::int AS n FROM list_pings WHERE shop_id = ANY($1)`, [sim]),
      ).toBe(0);
      expect(
        await n(`SELECT count(*)::int AS n FROM delivery_orders WHERE shop_id = ANY($1)`, [sim]),
      ).toBe(0);
      expect(
        await n(
          `SELECT count(*)::int AS n FROM list_ping_lines lpl
             JOIN list_pings lp ON lp.id = lpl.list_ping_id WHERE lp.shop_id = ANY($1)`,
          [sim],
        ),
      ).toBe(0);
      // The real shop keeps its ping, its answered line and its order; the list and line stay.
      const realId = realShop.body.id as string;
      expect(
        await n(`SELECT count(*)::int AS n FROM list_pings WHERE shop_id = $1`, [realId]),
      ).toBe(1);
      expect(
        await n(
          `SELECT count(*)::int AS n FROM list_ping_lines lpl
             JOIN list_pings lp ON lp.id = lpl.list_ping_id WHERE lp.shop_id = $1`,
          [realId],
        ),
      ).toBe(1);
      expect(
        await n(`SELECT count(*)::int AS n FROM delivery_orders WHERE shop_id = $1`, [realId]),
      ).toBe(1);
      expect(
        await n(`SELECT count(*)::int AS n FROM shopping_lists WHERE id = $1`, [list.id]),
      ).toBe(1);
    }, 30_000);

    it('is fine on an empty set', async () => {
      const res = await wipe();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ shops: 0, users: 0 });
    });
  });

  describe('GET /admin/sim/events', () => {
    // An admin gets a ticket from the admin route; a user from the ordinary one.
    const ticketFor = async (u: User) => {
      const path = u === admin ? '/admin/sim/ticket' : '/events/ticket';
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: auth(u) });
      return ((await res.json()) as { ticket: string }).ticket;
    };

    it('needs a ticket that belongs to an admin: a seeker or shop ticket gets 404', async () => {
      for (const u of [seeker, shop]) {
        const stream = await openSse(`${base}/admin/sim/events?ticket=${await ticketFor(u)}`);
        expect(stream.status).toBe(404);
      }
      expect((await openSse(`${base}/admin/sim/events`)).status).toBe(404);
      expect((await openSse(`${base}/admin/sim/events?ticket=made-up`)).status).toBe(404);
    });

    it('opens for a ticket from the admin route, once', async () => {
      const ticket = await ticketFor(admin);
      const stream = await openSse(`${base}/admin/sim/events?ticket=${ticket}`);
      streams.push(stream);
      expect(stream.status).toBe(200);
      expect(stream.contentType).toMatch(/^text\/event-stream/);
      expect((await openSse(`${base}/admin/sim/events?ticket=${ticket}`)).status).toBe(404);
    });

    it('carries ping.created for ALL simulated shops on one connection, and for no real shop', async () => {
      const made = (await create({ ...body, count: 12, radiusM: 1000 })).body as {
        shopId: string;
        token: string;
      }[];
      const realOwner = await loginAs(app, 'shop', String(phone++));
      const realShop = await request(app)
        .post('/shops')
        .set(auth(realOwner))
        .send({ name: 'Real Pinged', lat: north(0.01), lng: ORIGIN.lng, categories: ['grocery'] });

      const stream = await openSse(`${base}/admin/sim/events?ticket=${await ticketFor(admin)}`);
      streams.push(stream);
      const asked = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q: 'aata', lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(asked.body.state).toBe('PINGING');

      const pings = await waitFor(
        async () =>
          (
            await pool.query<{ id: string; shop_id: string; is_simulated: boolean }>(
              `SELECT p.id, p.shop_id, s.is_simulated FROM pings p JOIN shops s ON s.id = p.shop_id
                WHERE p.request_id = $1`,
              [asked.body.id],
            )
          ).rows,
        (rows) => rows.length >= 3,
      );
      const simulatedPings = pings.filter((p) => p.is_simulated);
      expect(simulatedPings.length).toBeGreaterThan(0);
      await waitFor(
        async () => stream.events.length,
        (n) => n >= simulatedPings.length,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      const created = stream.events.filter((e) => e.type === 'ping.created');
      expect(created.map((e) => e.data['pingId']).sort()).toEqual(
        simulatedPings.map((p) => p.id).sort(),
      );
      const realPing = pings.find((p) => !p.is_simulated);
      if (realPing) expect(created.map((e) => e.data['pingId'])).not.toContain(realPing.id);

      // What the simulator needs to decide: who, what, and the reference price.
      const first = created[0];
      expect(first?.data).toMatchObject({
        shopId: expect.any(String),
        item: { slug: 'wheat-flour', nameEn: 'wheat flour' },
        refPricePaise: 25000,
      });
      expect(made.map((s) => s.shopId)).toContain(first?.data['shopId']);
      expect(realShop.status).toBe(201);

      // And the simulated shop answers through the real endpoint with its own token.
      const mine = simulatedPings[0] as { id: string; shop_id: string };
      const token = made.find((s) => s.shopId === mine.shop_id)?.token as string;
      const answered = await request(app)
        .post(`/pings/${mine.id}/answer`)
        .set(auth({ token }))
        .send({ answer: 'yes', pricePaise: 24000, quantityHint: 'plenty' });
      expect(answered.status).toBe(200);
      const view = await request(app).get(`/requests/${asked.body.id}`).set(auth(seeker));
      expect(view.body.state).toBe('ANSWERED');
      await wipe();
    });
  });
});
