import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { sweepOrderAddresses } from './modules/orders/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

// ADR-0033 (PR E): finding an order again, and what happens to the address afterwards.
describe('my orders, recent work and the address (ADR-0033)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_895_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let other: User;
  let shop: User & { shopId: string };
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
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Order Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    shop = { ...owner, shopId: made.body.id as string };
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'requests, pings, shop_stock, delivery_orders, errands, saved_addresses',
    );
    await pool.query(`UPDATE shops SET closed_until = NULL, is_simulated = false`);
  });

  async function answeredRequest(q = 'chini') {
    // What the shop learned from an earlier yes would answer this request without asking it.
    await pool.query('DELETE FROM shop_stock');
    const made = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
    const requestId = made.body.id as string;
    await fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, requestId, claimsAll);
    const pings = (await request(app).get('/shops/me/pings').set(auth(shop))).body;
    await request(app)
      .post(`/pings/${pings[0].id}/answer`)
      .set(auth(shop))
      .send({ answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } });
    // Older than 30 minutes, so the order starts REQUESTED (a fresh offer starts ACCEPTED).
    await pool.query(`UPDATE pings SET answered_at = answered_at - interval '31 minutes'`);
    return requestId;
  }
  const place = (requestId: string, over: Record<string, unknown> = {}) =>
    request(app)
      .post('/orders')
      .set(auth(seeker))
      .send({ shopId: shop.shopId, requestId, addressText: ADDRESS, ...over });
  const act = (id: string, verb: string) =>
    request(app).post(`/orders/${id}/${verb}`).set(auth(shop));
  const row = async (id: string) =>
    (await pool.query(`SELECT * FROM delivery_orders WHERE id = $1`, [id])).rows[0];
  const deliver = async (id: string) => {
    await act(id, 'accept');
    await act(id, 'out');
    await request(app).post(`/orders/${id}/received`).set(auth(seeker));
  };

  describe('Mere orders', () => {
    it('lists every order of the customer, active first, and nobody else’s', async () => {
      const done = (await place(await answeredRequest())).body.id as string;
      await deliver(done);
      await pool.query(`UPDATE delivery_orders SET created_at = now() - interval '1 hour'`);
      const active = (await place(await answeredRequest())).body.id as string;

      const mine = await request(app).get('/orders').set(auth(seeker));
      expect(mine.status).toBe(200);
      expect(mine.body.map((o: { id: string }) => o.id)).toEqual([active, done]);
      expect(mine.body[0]).toMatchObject({ state: 'REQUESTED', shopName: 'Order Kirana' });

      const theirs = await request(app).get('/orders').set(auth(other));
      expect(theirs.body).toEqual([]);
      expect((await request(app).get('/orders')).status).toBe(401);
    });

    it('a finished order stays openable by id, and a stranger gets 404', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      await deliver(id);
      const res = await request(app).get(`/orders/${id}`).set(auth(seeker));
      expect(res.body).toMatchObject({ id, state: 'DELIVERED' });
      expect((await request(app).get(`/orders/${id}`).set(auth(other))).status).toBe(404);
    });
  });

  describe('recent work', () => {
    it('lists the last 10 searches and the errands of the customer, newest first', async () => {
      for (let i = 0; i < 11; i++) {
        await request(app)
          .post('/requests')
          .set(auth(seeker))
          .set('Idempotency-Key', `key-${i}`)
          .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng });
        await pool.query(
          `UPDATE requests SET state = 'CLOSED' WHERE state IN ('OPEN', 'PINGING', 'ANSWERED')`,
        );
      }
      await request(app)
        .post('/requests')
        .set(auth(other))
        .send({ q: 'atta', lat: ORIGIN.lat, lng: ORIGIN.lng });
      const searches = await request(app).get('/requests').set(auth(seeker));
      expect(searches.status).toBe(200);
      expect(searches.body).toHaveLength(10);
      expect(searches.body[0]).toMatchObject({
        id: expect.any(String),
        state: expect.any(String),
        query: 'chini',
        createdAt: expect.any(String),
      });
      const times = searches.body.map((s: { createdAt: string }) => Date.parse(s.createdAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      await pool.query(
        `INSERT INTO errands (user_id, task, location)
         VALUES ($1, 'chai ka saaman', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography),
                ($4, 'someone else', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)`,
        [seeker.userId, ORIGIN.lng, ORIGIN.lat, other.userId],
      );
      const errands = await request(app).get('/errands').set(auth(seeker));
      expect(errands.body).toHaveLength(1);
      expect(errands.body[0]).toMatchObject({ task: 'chai ka saaman' });
    });

    it('lists the customer’s last 20 errands, newest first, with only the minimal fields', async () => {
      await pool.query(
        `INSERT INTO errands (user_id, task, location, created_at)
         SELECT $1, 'task ' || n, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                now() - (n || ' minutes')::interval
           FROM generate_series(1, 25) AS n`,
        [seeker.userId, ORIGIN.lng, ORIGIN.lat],
      );
      const res = await request(app).get('/errands').set(auth(seeker));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(20);
      expect(res.body[0].task).toBe('task 1');
      expect(Object.keys(res.body[0]).sort()).toEqual([
        'createdAt',
        'expiresAt',
        'id',
        'state',
        'task',
      ]);
      expect(res.body[0].expiresAt).toEqual(expect.any(String));
    });

    it('needs a login', async () => {
      expect((await request(app).get('/errands')).status).toBe(401);
    });

    it('a search can be opened again, and its view still never carries the customer’s own point', async () => {
      const id = await answeredRequest();
      const res = await request(app).get(`/requests/${id}`).set(auth(seeker));
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('origin');
      expect(JSON.stringify(res.body)).not.toContain(String(ORIGIN.lat).slice(0, 7));
    });
  });

  describe('the shop’s orders', () => {
    it('shows open orders first and finished ones after, even days old', async () => {
      const old = (await place(await answeredRequest())).body.id as string;
      await deliver(old);
      await pool.query(
        `UPDATE delivery_orders SET created_at = now() - interval '3 days',
                                    updated_at = now() - interval '3 days'`,
      );
      const open = (await place(await answeredRequest())).body.id as string;
      const res = await request(app).get('/shops/me/orders').set(auth(shop));
      expect(res.body.map((o: { id: string }) => o.id)).toEqual([open, old]);
    });
  });

  describe('the address is kept only if the customer asks', () => {
    const saved = () => request(app).get('/orders/saved-address').set(auth(seeker));

    it('an order without the tick saves nothing, and the last order is not "saved"', async () => {
      await place(await answeredRequest(), { customerName: 'Asha' });
      expect((await saved()).body).toEqual({ id: null, addressText: null, customerName: null });
    });

    it('with the tick the address goes on the profile; it can be deleted, and is only theirs', async () => {
      await place(await answeredRequest(), { saveAddress: true, customerName: 'Asha Verma' });
      expect((await saved()).body).toEqual({
        id: expect.any(String),
        addressText: ADDRESS,
        customerName: 'Asha',
      });
      const strangers = await request(app).get('/orders/saved-address').set(auth(other));
      expect(strangers.body).toEqual({ id: null, addressText: null, customerName: null });

      expect((await request(app).delete('/orders/saved-address').set(auth(seeker))).status).toBe(
        204,
      );
      expect((await saved()).body).toEqual({ id: null, addressText: null, customerName: null });
    });

    it('a later order without the tick leaves the saved address as it was', async () => {
      await place(await answeredRequest(), { saveAddress: true });
      await pool.query(`UPDATE delivery_orders SET state = 'CANCELLED'`);
      await place(await answeredRequest('atta'), { addressText: 'Somewhere else entirely' });
      expect((await saved()).body.addressText).toBe(ADDRESS);
    });
  });

  describe('the 30-day sweep', () => {
    const age = (id: string, days: number) =>
      pool.query(
        `UPDATE delivery_orders SET updated_at = now() - make_interval(days => $2)
                   WHERE id = $1`,
        [id, days],
      );

    it('clears address and pin 30 days after a final state, and only then', async () => {
      const delivered = (await place(await answeredRequest())).body.id as string;
      await deliver(delivered);
      const recent = (await place(await answeredRequest('atta'))).body.id as string;
      await deliver(recent);
      const open = (await place(await answeredRequest('namak'))).body.id as string;
      await act(open, 'accept');
      await age(delivered, 31);
      await age(recent, 29);
      await age(open, 40);

      const cleared = await sweepOrderAddresses({ db: pool, logger: quiet });
      expect(cleared).toBe(1);

      expect(await row(delivered)).toMatchObject({ address_text: null, lat: null, lng: null });
      expect((await row(recent)).address_text).toBe(ADDRESS);
      expect((await row(open)).address_text).toBe(ADDRESS);
      expect(await sweepOrderAddresses({ db: pool, logger: quiet })).toBe(0);
    });

    it('the order itself stays: the customer still sees it, without an address; the shop gets none', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      await deliver(id);
      await age(id, 31);
      await sweepOrderAddresses({ db: pool, logger: quiet });

      const mine = await request(app).get(`/orders/${id}`).set(auth(seeker));
      expect(mine.body).toMatchObject({ id, state: 'DELIVERED', addressText: null });
      const theirs = (await request(app).get('/shops/me/orders').set(auth(shop))).body[0];
      expect(theirs.state).toBe('DELIVERED');
      expect(theirs.addressText).toBeUndefined();
      expect(theirs.mapUrl).toBeUndefined();
    });

    it('does not touch the profile’s saved address', async () => {
      const id = (await place(await answeredRequest(), { saveAddress: true })).body.id as string;
      await deliver(id);
      await age(id, 31);
      await sweepOrderAddresses({ db: pool, logger: quiet });
      const res = await request(app).get('/orders/saved-address').set(auth(seeker));
      expect(res.body.addressText).toBe(ADDRESS);
    });
  });
});
