import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const VAPID = { publicKey: 'BPublicKey-for-tests', privateKey: 'p', subject: 'mailto:o@e.com' };
const sub = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/account-${n}`,
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u',
    auth: 'tBHItJI5s',
  },
});
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

// ADR-0054: log out, the saved address, and soft-deleting a customer account.
describe('customer account (ADR-0054)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_894_000_000;
  let shopId: string;
  let itemId: string;
  const quiet = pino({ level: 'silent' });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const newSeeker = async () => {
    const p = String(phone++);
    return { ...(await loginAs(app, 'seeker', p)), phone: `+91${p}` };
  };
  const subscribe = (u: { token: string }, n: number) =>
    request(app).post('/push/subscribe').set(auth(u)).send(sub(n));
  const count = async (table: string, userId: string) =>
    Number(
      (await pool.query(`SELECT count(*) FROM ${table} WHERE user_id = $1`, [userId])).rows[0]
        .count,
    );
  const insertOrder = (userId: string, state: string) =>
    pool.query(
      `INSERT INTO delivery_orders (user_id, shop_id, source_id, state, lines, address_text,
                                    customer_first_name, lat, lng, expires_at)
       VALUES ($1, $2, gen_random_uuid(), $3, '[{"name":"Sugar","count":1,"pricePaise":4000}]',
               $4, 'Asha', 22.7, 75.8, now() + interval '1 hour')`,
      [userId, shopId, state, ADDRESS],
    );
  const insertRequest = (userId: string, state: string) =>
    pool.query(
      `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, expires_at)
       VALUES ($1, $2, 'sugar', ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 1000, $5,
               now() + interval '10 minutes')`,
      [userId, itemId, ORIGIN.lng, ORIGIN.lat, state],
    );

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({
      config: testConfig({ vapid: VAPID }),
      logger: quiet,
      db: pool,
      realtime: createRealtime({ redisUrl: null, logger: quiet }),
    });
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Account Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    shopId = made.body.id as string;
    itemId = (await pool.query(`SELECT id FROM items LIMIT 1`)).rows[0].id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  it('shows the phone partly hidden and never in full', async () => {
    const u = await newSeeker();
    const res = await request(app).get('/account').set(auth(u));
    expect(res.status).toBe(200);
    const digits = u.phone.slice(3);
    expect(res.body.phoneMasked).toBe(`+91 ${digits.slice(0, 2)}••• ••${digits.slice(-3)}`);
    expect(JSON.stringify(res.body)).not.toContain(digits);
    expect((await request(app).get('/account')).status).toBe(401);
  });

  it('says whether the account is a demo number, for its own owner only (X-01)', async () => {
    const demoPhone = '9000000208';
    const demoApp = createApp({
      config: testConfig({ demoPhones: [`+91${demoPhone}`] }),
      logger: quiet,
      db: pool,
      realtime: createRealtime({ redisUrl: null, logger: quiet }),
    });
    const demo = await loginAs(demoApp, 'seeker', demoPhone);
    const asDemo = await request(demoApp).get('/account').set(auth(demo));
    expect(asDemo.body.demo).toBe(true);
    const other = await newSeeker();
    const asOther = await request(demoApp).get('/account').set(auth(other));
    expect(asOther.body.demo).toBe(false);
    // The default app has no demo numbers at all.
    expect((await request(app).get('/account').set(auth(other))).body.demo).toBe(false);
  });

  it('log out makes the old token fail', async () => {
    const u = await newSeeker();
    expect((await request(app).get('/orders').set(auth(u))).status).toBe(200);
    expect((await request(app).post('/account/logout').set(auth(u)).send({})).status).toBe(204);
    expect((await request(app).get('/orders').set(auth(u))).status).toBe(401);
    expect((await request(app).get('/account').set(auth(u))).status).toBe(401);
  });

  describe('log out on all devices (ADR-0060)', () => {
    const login = (u: { phone: string }) =>
      loginAs(app, 'seeker', u.phone.slice(3)).then((x) => ({ token: x.token }));

    it('needs a login, takes no fields, and is a 204 that kills every session of the caller', async () => {
      expect((await request(app).post('/account/logout-all').send({})).status).toBe(401);
      const u = await newSeeker();
      const second = await login(u);
      const third = await login(u);
      expect(second.token).not.toBe(u.token);
      const bad = await request(app).post('/account/logout-all').set(auth(u)).send({ x: 1 });
      expect(bad.status).toBe(400);
      expect((await request(app).get('/account').set(auth(second))).status).toBe(200);
      const res = await request(app).post('/account/logout-all').set(auth(u)).send({});
      expect(res.status).toBe(204);
      for (const t of [u, second, third])
        expect((await request(app).get('/account').set(auth(t))).status).toBe(401);
      expect((await request(app).post('/account/logout-all').set(auth(u)).send({})).status).toBe(
        401,
      );
    });

    it('does not touch another person’s sessions', async () => {
      const u = await newSeeker();
      const v = await newSeeker();
      await request(app).post('/account/logout-all').set(auth(u)).send({});
      expect((await request(app).get('/account').set(auth(v))).status).toBe(200);
    });

    it('forgets the alerts of every device, not only this one', async () => {
      const u = await newSeeker();
      const v = await newSeeker();
      await subscribe(u, 21);
      await subscribe(u, 22);
      await subscribe(v, 23);
      await request(app).post('/account/logout-all').set(auth(u)).send({});
      expect(await count('push_subscriptions', u.userId)).toBe(0);
      expect(await count('push_subscriptions', v.userId)).toBe(1);
    });

    it('works for a shop too, and the user can log in again afterwards', async () => {
      const owner = await loginAs(app, 'shop', String(phone++));
      expect(
        (await request(app).post('/account/logout-all').set(auth(owner)).send({})).status,
      ).toBe(204);
      expect((await request(app).get('/shops/me').set(auth(owner))).status).toBe(401);
      const again = await loginAs(app, 'shop', String(phone - 1));
      expect((await request(app).get('/account').set(auth(again))).status).toBe(200);
    });
  });

  it('log out removes the push subscription of this device only', async () => {
    const u = await newSeeker();
    await subscribe(u, 1);
    await subscribe(u, 2);
    const res = await request(app)
      .post('/account/logout')
      .set(auth(u))
      .send({ pushEndpoint: sub(1).endpoint });
    expect(res.status).toBe(204);
    const left = await pool.query(`SELECT endpoint FROM push_subscriptions WHERE user_id = $1`, [
      u.userId,
    ]);
    expect(left.rows.map((r) => r.endpoint)).toEqual([sub(2).endpoint]);
  });

  it('a push subscription is deleted on toggle-off, and only for its owner', async () => {
    const u = await newSeeker();
    const v = await newSeeker();
    await subscribe(u, 3);
    await request(app)
      .post('/push/unsubscribe')
      .set(auth(v))
      .send({ endpoint: sub(3).endpoint });
    expect(await count('push_subscriptions', u.userId)).toBe(1);
    const off = await request(app)
      .post('/push/unsubscribe')
      .set(auth(u))
      .send({ endpoint: sub(3).endpoint });
    expect(off.status).toBe(204);
    expect(await count('push_subscriptions', u.userId)).toBe(0);
  });

  it('log out cannot remove another person’s subscription', async () => {
    const u = await newSeeker();
    const v = await newSeeker();
    await subscribe(v, 4);
    await request(app)
      .post('/account/logout')
      .set(auth(u))
      .send({ pushEndpoint: sub(4).endpoint });
    expect(await count('push_subscriptions', v.userId)).toBe(1);
  });

  it('an address update persists', async () => {
    const u = await newSeeker();
    const put = await request(app).put('/orders/saved-address').set(auth(u)).send({
      addressText: ADDRESS,
    });
    expect(put.status).toBe(200);
    const next = '12, Palasia Square, Indore';
    await request(app).put('/orders/saved-address').set(auth(u)).send({ addressText: next });
    const got = await request(app).get('/orders/saved-address').set(auth(u));
    expect(got.body.addressText).toBe(next);
  });

  it('one customer cannot read or change another’s address', async () => {
    const u = await newSeeker();
    const v = await newSeeker();
    await request(app).put('/orders/saved-address').set(auth(u)).send({ addressText: ADDRESS });
    await request(app)
      .put('/orders/saved-address')
      .set(auth(v))
      .send({ addressText: 'Elsewhere 22' });
    expect((await request(app).get('/orders/saved-address').set(auth(u))).body.addressText).toBe(
      ADDRESS,
    );
    await request(app).delete('/orders/saved-address').set(auth(v));
    expect((await request(app).get('/orders/saved-address').set(auth(u))).body.addressText).toBe(
      ADDRESS,
    );
  });

  it('delete erases phone, address, subscriptions and sessions; orders and requests remain', async () => {
    const u = await newSeeker();
    const other = await newSeeker();
    await request(app).put('/orders/saved-address').set(auth(u)).send({ addressText: ADDRESS });
    await subscribe(u, 5);
    await subscribe(other, 6);
    await insertOrder(u.userId, 'DELIVERED');
    await insertRequest(u.userId, 'CLOSED');
    const second = await loginAs(app, 'seeker', u.phone.slice(3)).catch(() => null);
    expect(second).not.toBeNull();

    const res = await request(app).delete('/account').set(auth(u));
    expect(res.status).toBe(204);

    const row = (await pool.query(`SELECT phone, deleted_at FROM users WHERE id = $1`, [u.userId]))
      .rows[0];
    expect(row.phone).toBeNull();
    expect(row.deleted_at).not.toBeNull();
    expect(await count('saved_addresses', u.userId)).toBe(0);
    expect(await count('push_subscriptions', u.userId)).toBe(0);
    expect(await count('sessions', u.userId)).toBe(0);
    expect(await count('delivery_orders', u.userId)).toBe(1);
    expect(await count('requests', u.userId)).toBe(1);
    const kept = (
      await pool.query(
        `SELECT address_text, customer_first_name FROM delivery_orders WHERE user_id = $1`,
        [u.userId],
      )
    ).rows[0];
    expect(kept).toEqual({ address_text: null, customer_first_name: null });
    // The other customer is untouched.
    expect(await count('push_subscriptions', other.userId)).toBe(1);
    expect((await request(app).get('/account').set(auth(other))).status).toBe(200);
    // The old token is dead, and the same phone can register again as a new account.
    expect((await request(app).get('/account').set(auth(u))).status).toBe(401);
    const again = await loginAs(app, 'seeker', u.phone.slice(3));
    expect(again.token).toBeTruthy();
    expect(again.userId).not.toBe(u.userId);
  });

  for (const state of ['REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY']) {
    it(`delete is refused with an open ${state} order`, async () => {
      const u = await newSeeker();
      await insertOrder(u.userId, state);
      const res = await request(app).delete('/account').set(auth(u));
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Finish or cancel your open order first.');
      const row = (
        await pool.query(`SELECT phone, deleted_at FROM users WHERE id = $1`, [u.userId])
      ).rows[0];
      expect(row.phone).toBe(u.phone);
      expect(row.deleted_at).toBeNull();
      expect((await request(app).get('/account').set(auth(u))).status).toBe(200);
    });
  }

  it('delete is refused while a request is live, and allowed once it is closed', async () => {
    const u = await newSeeker();
    await insertRequest(u.userId, 'PINGING');
    const res = await request(app).delete('/account').set(auth(u));
    expect(res.status).toBe(409);
    await pool.query(`UPDATE requests SET state = 'CLOSED' WHERE user_id = $1`, [u.userId]);
    expect((await request(app).delete('/account').set(auth(u))).status).toBe(204);
  });

  it('delete needs a login and is limited like other auth endpoints', async () => {
    expect((await request(app).delete('/account')).status).toBe(401);
    const u = await newSeeker();
    await insertOrder(u.userId, 'ACCEPTED');
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await request(app).delete('/account').set(auth(u))).status);
    }
    expect(codes.slice(0, 5)).toEqual([409, 409, 409, 409, 409]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('a shop owner cannot delete a shop through the customer account', async () => {
    const owner = await loginAs(app, 'shop', String(phone++));
    expect((await request(app).delete('/account').set(auth(owner))).status).toBe(403);
  });
});
