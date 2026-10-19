import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createNotifier, type EnqueuePush } from './modules/push/index.js';
import { createRateLimiter, type CounterStore } from './modules/push/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { sweepPickups } from './modules/pickups/index.js';
import { recordStockYes } from './modules/shops/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// ADR-0035: "Le liya?" — the customer's word keeps learned stock honest, and stays anonymous.
describe('"Le liya?": pickups, the question, and what the answers do to learned stock', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_894_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let other: User;
  let owner: User;
  let shopId: string;
  let itemId: string;
  const quiet = pino({ level: 'silent' });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

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
    seeker = await loginAs(app, 'seeker', String(phone++));
    other = await loginAs(app, 'seeker', String(phone++));
    owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Le Liya Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    shopId = made.body.id as string;
    itemId = (
      await pool.query<{ id: string }>(
        `SELECT item_id AS id FROM item_synonyms WHERE term = 'chini'`,
      )
    ).rows[0]?.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE requests, pings, shop_stock, delivery_orders, pickup_visits CASCADE',
    );
    await pool.query(`UPDATE shops SET closed_until = NULL, is_simulated = false`);
    await learn();
  });

  /** The shop said yes to chini a while ago: learned stock, shown as "Likely". */
  async function learn(over: { shop?: string; hoursAgo?: number } = {}) {
    await recordStockYes(pool, {
      shopId: over.shop ?? shopId,
      itemId,
      pricePaise: 4500,
      quantityHint: null,
      confirmedAt: new Date(Date.now() - (over.hoursAgo ?? 30) * 3_600_000),
    });
  }
  const search = async (who: User = seeker) =>
    (
      await request(app)
        .post('/requests')
        .set(auth(who))
        .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng })
    ).body as { id: string; results: Record<string, unknown>[] };
  const tap = (who: User, requestId: string, over: Record<string, unknown> = {}) =>
    request(app)
      .post('/pickups')
      .set(auth(who))
      .send({ shopId, itemId, requestId, ...over });
  const stock = async (shop = shopId) =>
    (
      await pool.query(`SELECT * FROM shop_stock WHERE shop_id = $1 AND item_id = $2`, [
        shop,
        itemId,
      ])
    ).rows[0];
  const visits = async () => (await pool.query(`SELECT * FROM pickup_visits`)).rows;
  /** Pretends the customer tapped "Raasta" `minutes` ago. */
  const age = (minutes: number) =>
    pool.query(`UPDATE pickup_visits SET created_at = now() - make_interval(mins => $1::int)`, [
      minutes,
    ]);
  const pending = (who: User) => request(app).get('/pickups/pending').set(auth(who));
  const reply = (who: User, id: string, answer: string) =>
    request(app).post(`/pickups/${id}/answer`).set(auth(who)).send({ answer });

  /** One pickup tapped and old enough to be asked about; returns the visit id. */
  async function visited(who: User = seeker) {
    const { id } = await search(who);
    expect((await tap(who, id)).status).toBe(204);
    await age(20);
    return (await pending(who)).body[0].id as string;
  }

  describe('recording the tap on "Raasta"', () => {
    it('records one visit for a result card, and a second tap changes nothing', async () => {
      const { id } = await search();
      expect((await tap(seeker, id)).status).toBe(204);
      expect((await tap(seeker, id)).status).toBe(204);
      const rows = await visits();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: seeker.userId,
        shop_id: shopId,
        item_id: itemId,
        request_id: id,
        answer: null,
        asked_at: null,
        push_sent_at: null,
      });
    });

    it('records a plan-card tap against the errand', async () => {
      const errand = (
        await pool.query<{ id: string }>(
          `INSERT INTO errands (user_id, task, location, expires_at)
           VALUES ($1, 'chini', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, now() + interval '1 hour')
           RETURNING id`,
          [seeker.userId, ORIGIN.lng, ORIGIN.lat],
        )
      ).rows[0]?.id as string;
      const res = await request(app)
        .post('/pickups')
        .set(auth(seeker))
        .send({ shopId, itemId, errandId: errand });
      expect(res.status).toBe(204);
      expect((await visits())[0]).toMatchObject({ errand_id: errand, request_id: null });
    });

    it('needs a customer login', async () => {
      const { id } = await search();
      expect(
        (await request(app).post('/pickups').send({ shopId, itemId, requestId: id })).status,
      ).toBe(401);
      expect((await tap(owner, id)).status).toBe(403);
      expect((await request(app).get('/pickups/pending')).status).toBe(401);
    });

    it("refuses a request that is not the customer's, a bad body, and a shop with no stock of the item", async () => {
      const { id } = await search();
      expect((await tap(other, id)).status).toBe(404);
      expect((await tap(seeker, id, { shopId: 'nope' })).status).toBe(400);
      expect((await tap(seeker, id, { requestId: undefined, errandId: undefined })).status).toBe(
        400,
      );
      await pool.query('DELETE FROM shop_stock');
      expect((await tap(seeker, id)).status).toBe(404);
      expect(await visits()).toHaveLength(0);
    });

    it('records nothing for a shop the customer is having the item delivered from', async () => {
      const { id } = await search();
      await pool.query(
        `INSERT INTO delivery_orders (user_id, shop_id, request_id, source_id, state, lines,
                                      address_text, lat, lng, expires_at)
         VALUES ($1, $2, $3, $3, 'ACCEPTED', '[{"name":"Chini","count":1,"pricePaise":4500}]',
                 'Flat 4B, Sapna Apartments', 22.7, 75.8, now() + interval '1 hour')`,
        [seeker.userId, shopId, id],
      );
      expect((await tap(seeker, id)).status).toBe(204);
      expect(await visits()).toHaveLength(0);
    });
  });

  describe('the question on the home screen', () => {
    it('waits a little after the tap, then names the item and the shop', async () => {
      const { id } = await search();
      await tap(seeker, id);
      expect((await pending(seeker)).body).toEqual([]);
      await age(20);
      const res = await pending(seeker);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        item: { nameEn: expect.any(String), nameHi: expect.any(String) },
        shop: { name: 'Le Liya Kirana' },
      });
      expect((await visits())[0].asked_at).toBeInstanceOf(Date);
    });

    it("is the customer's own: another customer sees nothing", async () => {
      await visited();
      expect((await pending(other)).body).toEqual([]);
    });

    it('is asked until answered, then never again for that customer, shop and item', async () => {
      const visit = await visited();
      expect((await pending(seeker)).body).toHaveLength(1);
      expect((await reply(seeker, visit, 'not_gone')).status).toBe(204);
      expect((await pending(seeker)).body).toEqual([]);
      // Tapping "Raasta" on the same shop and item again does not start a new question.
      const { id } = await search();
      await tap(seeker, id);
      await age(20);
      expect((await pending(seeker)).body).toEqual([]);
      expect(await visits()).toHaveLength(1);
    });
  });

  describe('"Mil gaya"', () => {
    it('refreshes the answer and marks it as confirmed by a customer', async () => {
      const before = await stock();
      const visit = await visited();
      expect((await reply(seeker, visit, 'found')).status).toBe(204);
      const after = await stock();
      expect(after.last_confirmed_at.getTime()).toBeGreaterThan(before.last_confirmed_at.getTime());
      expect(after.expires_at.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3_600_000);
      expect(after.customer_verified_at).toBeInstanceOf(Date);
      expect(after.price_paise).toBe(4500);
    });

    it('shows "customer verified" on the next card, as learned stock', async () => {
      const visit = await visited();
      await reply(seeker, visit, 'found');
      const next = await search(other);
      expect(next.results).toHaveLength(1);
      expect(next.results[0]).toMatchObject({
        shopId,
        source: 'learned',
        customerVerified: true,
        freshness: 'Confirmed today',
      });
    });

    it('is forgotten when the shop answers again itself', async () => {
      const visit = await visited();
      await reply(seeker, visit, 'found');
      await learn({ hoursAgo: 0 });
      expect((await stock()).customer_verified_at).toBeNull();
      expect((await search(other)).results[0]).not.toHaveProperty('customerVerified');
    });

    it('lets one earlier wrong report go', async () => {
      await pool.query(`UPDATE shop_stock SET wrong_reports = 1`);
      await reply(seeker, await visited(), 'found');
      expect((await stock()).wrong_reports).toBe(0);
    });
  });

  describe('"Wahan nahi tha"', () => {
    it('invalidates the learned answer at once and counts it against the shop for that item', async () => {
      const visit = await visited();
      expect((await reply(seeker, visit, 'not_there')).status).toBe(204);
      const after = await stock();
      expect(after.expires_at.getTime()).toBeLessThanOrEqual(Date.now());
      expect(after.wrong_reports).toBe(1);
      // It no longer shows as Likely anywhere learned stock is read.
      expect((await search(other)).results).toEqual([]);
    });

    it('only counts the shop for the item reported, not its other items', async () => {
      const dal = (
        await pool.query<{ id: string }>(`SELECT id FROM items WHERE id <> $1 LIMIT 1`, [itemId])
      ).rows[0]?.id as string;
      await recordStockYes(pool, {
        shopId,
        itemId: dal,
        pricePaise: 100,
        quantityHint: null,
        confirmedAt: new Date(),
      });
      await reply(seeker, await visited(), 'not_there');
      const other_ = (
        await pool.query(`SELECT wrong_reports, expires_at FROM shop_stock WHERE item_id = $1`, [
          dal,
        ])
      ).rows[0];
      expect(other_.wrong_reports).toBe(0);
      expect(other_.expires_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('ranks a shop with repeated wrong answers below the others, without saying why', async () => {
      const farther = (
        await pool.query<{ id: string }>(
          `INSERT INTO shops (name, phone, categories, location)
           VALUES ('Door Kirana', '+910000000001', ARRAY['grocery'],
                   ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) RETURNING id`,
          [ORIGIN.lng, north(1.5)],
        )
      ).rows[0]?.id as string;
      // Two different customers each came away empty-handed from the nearer shop.
      for (const who of [seeker, other]) {
        await learn();
        await reply(who, await visited(who), 'not_there');
        await pool.query('TRUNCATE pickup_visits');
      }
      expect((await stock()).wrong_reports).toBe(2);
      await learn({ hoursAgo: 0 });
      await learn({ shop: farther, hoursAgo: 0 });
      const { results } = await search();
      expect(results.map((r) => r['name'])).toEqual(['Door Kirana', 'Le Liya Kirana']);
      expect(JSON.stringify(results)).not.toMatch(/wrong|doubt|report/i);
    });

    it('does not rank a shop down for a single wrong answer', async () => {
      await reply(seeker, await visited(), 'not_there');
      await learn({ hoursAgo: 0 });
      expect((await search()).results[0]).toMatchObject({ name: 'Le Liya Kirana' });
    });
  });

  describe('"Gaya nahi"', () => {
    it("changes nothing about the shop's answer", async () => {
      const before = await stock();
      await reply(seeker, await visited(), 'not_gone');
      expect(await stock()).toEqual(before);
      expect((await visits())[0]).toMatchObject({ answer: 'not_gone' });
    });
  });

  describe('answering', () => {
    it("is for the customer's own question, once", async () => {
      const visit = await visited();
      expect((await reply(other, visit, 'found')).status).toBe(404);
      expect((await reply(seeker, visit, 'maybe')).status).toBe(400);
      expect((await reply(owner, visit, 'found')).status).toBe(403);
      expect((await reply(seeker, visit, 'found')).status).toBe(204);
      const again = await reply(seeker, visit, 'not_there');
      expect(again.status).toBe(409);
      expect((await stock()).wrong_reports).toBe(0);
    });
  });

  describe('privacy: the shop never sees who reported', () => {
    it('keeps who and where out of everything the shop can read', async () => {
      await reply(seeker, await visited(), 'not_there');
      const seen = JSON.stringify([
        (await request(app).get('/shops/me').set(auth(owner))).body,
        (await request(app).get('/shops/me/pings').set(auth(owner))).body,
        (await request(app).get('/shops/me/demand').set(auth(owner))).body,
      ]);
      expect(seen).not.toContain(seeker.userId);
      for (let n = 0; n < 2; n++) expect(seen).not.toContain(String(9_894_000_000 + n));
      expect(seen).not.toMatch(/not_there|wrong_reports|pickup/i);
    });

    it('keeps the counter on the stock row free of any customer column', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'shop_stock'`,
      );
      expect(
        rows.map((r) => r.column_name).filter((c) => /user|customer_id|phone/.test(c)),
      ).toEqual([]);
    });

    it('forgets old visits: 30 days after the tap the row is gone', async () => {
      await visited();
      await pool.query(`UPDATE pickup_visits SET created_at = now() - interval '31 days'`);
      expect(await sweepPickups({ db: pool, logger: quiet })).toBe(1);
      expect(await visits()).toHaveLength(0);
      await visited();
      expect(await sweepPickups({ db: pool, logger: quiet })).toBe(0);
    });
  });
});

// The same question, one hour later, as a single push through the existing module and its limit.
describe('"Le liya?" push reminder (ADR-0034 module, ADR-0035)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let phone = 9_893_000_000;
  const quiet = pino({ level: 'silent' });
  let app: ReturnType<typeof createApp>;
  type User = { token: string; userId: string };
  let seeker: User;
  let owner: User;
  let shopId: string;
  let itemIds: string[];
  type Queued = { payload: { title: string; item: string; url: string }; subscriptionId: string };
  let queued: Queued[];
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  const memoryStore = (): CounterStore => {
    const counts = new Map<string, number>();
    return {
      async incr(key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts.get(key) as number;
      },
      async expire() {
        return 1;
      },
    };
  };
  const makeNotifier = (
    limiter = createRateLimiter(memoryStore(), { max: 5, windowSeconds: 60 }),
  ) => {
    const enqueue: EnqueuePush = async (job) => {
      queued.push(job);
    };
    return createNotifier({ db: pool, logger: quiet, enqueue, limiter, answerDebounceMs: 3000 });
  };

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
    seeker = await loginAs(app, 'seeker', String(phone++));
    owner = await loginAs(app, 'shop', String(phone++));
    shopId = (
      await request(app)
        .post('/shops')
        .set(auth(owner))
        .send({ name: 'Yaad Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] })
    ).body.id as string;
    itemIds = (
      await pool.query<{ id: string }>(`SELECT id FROM items ORDER BY slug LIMIT 3`)
    ).rows.map((r) => r.id);
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE requests, pings, shop_stock, pickup_visits, push_subscriptions CASCADE',
    );
    queued = [];
    await subscribed();
  });

  const subscribed = () =>
    pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, 'https://fcm.googleapis.com/fcm/send/seeker', 'k', 'a')`,
      [seeker.userId],
    );

  /** A pickup the customer tapped `minutes` ago. */
  async function visit(item: string, minutes: number, over: Record<string, string | null> = {}) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO pickup_visits (user_id, shop_id, item_id, created_at, asked_at, answer)
       VALUES ($1, $2, $3, now() - make_interval(mins => $4::int), $5, $6) RETURNING id`,
      [seeker.userId, shopId, item, minutes, over['askedAt'] ?? null, over['answer'] ?? null],
    );
    return (rows[0] as { id: string }).id;
  }
  const itemName = async (id: string) =>
    (await pool.query<{ name_en: string }>(`SELECT name_en FROM items WHERE id = $1`, [id])).rows[0]
      ?.name_en as string;

  it('pushes once, an hour after the tap, with the item and nothing about the shop', async () => {
    await visit(itemIds[0] as string, 61);
    const notifier = makeNotifier();
    expect(await notifier.remindPickups()).toBe(1);
    const name = await itemName(itemIds[0] as string);
    expect(queued).toHaveLength(1);
    expect((queued[0] as Queued).payload).toEqual({
      title: `Kya aapko ${name} mila?`,
      item: name,
      url: '/app/',
    });
    expect(JSON.stringify(queued)).not.toContain('Yaad Kirana');
    // A second look finds nothing left to remind.
    expect(await notifier.remindPickups()).toBe(0);
    expect(queued).toHaveLength(1);
  });

  it('waits until an hour has passed', async () => {
    await visit(itemIds[0] as string, 40);
    expect(await makeNotifier().remindPickups()).toBe(0);
    expect(queued).toEqual([]);
  });

  it('leaves out what was already asked on the home screen or answered', async () => {
    await visit(itemIds[0] as string, 90, { askedAt: new Date().toISOString() });
    await visit(itemIds[1] as string, 90, { answer: 'found' });
    expect(await makeNotifier().remindPickups()).toBe(0);
    expect(queued).toEqual([]);
  });

  it('is one push for several pickups', async () => {
    for (const item of itemIds) await visit(item, 75);
    expect(await makeNotifier().remindPickups()).toBe(1);
    expect(queued).toHaveLength(1);
    expect((queued[0] as Queued).payload.item).toMatch(/\+2$/);
  });

  it('counts against the same per-minute limit as every other push', async () => {
    await visit(itemIds[0] as string, 75);
    const limiter = createRateLimiter(memoryStore(), { max: 1, windowSeconds: 60 });
    // The one push this person may get this minute is already used.
    expect(await limiter.allow(seeker.userId)).toBe(true);
    await makeNotifier(limiter).remindPickups();
    expect(queued).toEqual([]);
  });

  it('is never sent to a customer with no subscribed device', async () => {
    await pool.query('TRUNCATE push_subscriptions');
    await visit(itemIds[0] as string, 75);
    expect(await makeNotifier().remindPickups()).toBe(0);
    expect(queued).toEqual([]);
  });
});
