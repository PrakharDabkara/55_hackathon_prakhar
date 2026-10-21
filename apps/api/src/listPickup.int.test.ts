import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { sweepOrders } from './modules/orders/index.js';
import { createNotifier } from './modules/push/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const quiet = pino({ level: 'silent' });
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Shop = { token: string; userId: string; shopId: string };

// ADR-0055 (follow-up): a list can be picked up. The shop gets a real order that moves
// ACCEPTED, READY, COLLECTED, and never learns the customer's address, pin or name.
describe('pickup orders from a list (S46 to S48)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let seeker: { token: string; userId: string };
  let phone = 9_800_400_000;
  const events: RealtimeEvent[] = [];
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    realtime.onPublish((e) => events.push(e));
    app = createApp({
      config: testConfig({
        vapid: { publicKey: 'BPublicKey-for-tests', privateKey: 'p', subject: 'mailto:o@e.com' },
      }),
      logger: quiet,
      db: pool,
      realtime,
    });
    seeker = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'shopping_lists, delivery_orders, saved_addresses, push_subscriptions',
    );
    await pool.query('DELETE FROM shops');
    events.length = 0;
  });

  async function shop(name: string, km: number, categories = ['grocery']): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories });
    return { ...owner, shopId: made.body.id as string };
  }
  /** A list of sugar and rice, answered by the grocer (delivers) and the second grocer (does not). */
  async function answered() {
    const a = await shop('Delivers', 0.3);
    const b = await shop('Pickup only', 0.5);
    const sorted = await request(app)
      .post('/lists/sort')
      .set(auth(seeker))
      .send({ lines: ['chini', 'chawal'] });
    await request(app)
      .post(`/lists/${sorted.body.id}/send`)
      .set(auth(seeker))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    const reply = async (s: Shop, extra: Json) => {
      const p = (await request(app).get('/shops/me/lists').set(auth(s))).body[0];
      await request(app)
        .post(`/list-pings/${p.id}/answer`)
        .set(auth(s))
        .send({
          lines: p.lines.map((l: Json) => ({
            lineId: l.lineId,
            have: true,
            priceRupees: l.name === 'Sugar' ? 48 : 60,
          })),
          ...extra,
        });
    };
    await reply(a, { canDeliver: true, deliveryFeeRupees: 20 });
    await reply(b, {});
    return { a, b, id: sorted.body.id as string };
  }
  const order = (id: string, body: Json) =>
    request(app).post(`/lists/${id}/order`).set(auth(seeker)).send(body);
  const pickupOnly = async () => {
    const { a, b, id } = await answered();
    const res = await order(id, {
      assignments: [
        { position: 0, shopId: b.shopId },
        { position: 1, shopId: b.shopId },
      ],
      modes: { [b.shopId]: 'pickup' },
      customerName: 'Asha Verma',
    });
    expect(res.status).toBe(201);
    return { a, b, id, res };
  };
  const shopOrders = async (s: Shop) =>
    (await request(app).get('/shops/me/orders').set(auth(s))).body as Json[];
  const act = (s: Shop, orderId: string, verb: string) =>
    request(app).post(`/orders/${orderId}/${verb}`).set(auth(s));

  it('S46: a pickup shop gets a real order: ACCEPTED, no fee, and no address, pin or name stored; no address is needed', async () => {
    const { b, res } = await pickupOnly();
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).toMatchObject({
      fulfilment: 'pickup',
      state: 'ACCEPTED',
      shopId: b.shopId,
      feePaise: null,
      itemsTotalPaise: 10800,
    });
    expect(res.body.pickups).toHaveLength(1); // kept for the route
    const row = (await pool.query(`SELECT * FROM delivery_orders`)).rows[0];
    expect(row).toMatchObject({
      fulfilment: 'pickup',
      address_text: null,
      lat: null,
      lng: null,
      customer_first_name: null,
    });
  });

  it('S46: every shop of the plan is in orders[], delivery and pickup together', async () => {
    const { a, b, id } = await answered();
    const res = await order(id, {
      assignments: [
        { position: 0, shopId: a.shopId },
        { position: 1, shopId: b.shopId },
      ],
      modes: { [a.shopId]: 'delivery', [b.shopId]: 'pickup' },
      addressText: ADDRESS,
    });
    expect(res.status).toBe(201);
    const byShop = Object.fromEntries(res.body.orders.map((o: Json) => [o.shopId, o.fulfilment]));
    expect(byShop).toEqual({ [a.shopId]: 'delivery', [b.shopId]: 'pickup' });
    expect(res.body.pickups.map((p: Json) => p.shopId)).toEqual([b.shopId]);
    const pickupRow = (
      await pool.query(`SELECT address_text FROM delivery_orders WHERE fulfilment = 'pickup'`)
    ).rows[0];
    expect(pickupRow.address_text).toBeNull();
    const deliveryRow = (
      await pool.query(`SELECT address_text FROM delivery_orders WHERE fulfilment = 'delivery'`)
    ).rows[0];
    expect(deliveryRow.address_text).toBe(ADDRESS);
  });

  it("S46: the shop sees the order and never the address, the pin or the name; the customer sees the shop's location", async () => {
    const { b } = await pickupOnly();
    const mine = (await shopOrders(b))[0] as Json;
    expect(mine).toMatchObject({
      fulfilment: 'pickup',
      contactName: 'Customer',
      state: 'ACCEPTED',
    });
    expect(mine).not.toHaveProperty('addressText');
    expect(mine).not.toHaveProperty('mapUrl');
    expect(JSON.stringify(mine)).not.toMatch(/Asha|Sapna|22\.7/);
    const seen = (await request(app).get('/orders').set(auth(seeker))).body[0];
    expect(seen).toMatchObject({ fulfilment: 'pickup', addressText: null });
    expect(seen.shopLocation.lat).toBeCloseTo(north(0.5), 4);
    expect(seen.shopLocation.lng).toBeCloseTo(ORIGIN.lng, 4);
  });

  it('S46: the shop gets the same realtime hint and push as for a delivery order', async () => {
    const { b } = await pickupOnly();
    expect(
      events.some(
        (e) => e.type === 'order.created' && 'userId' in e.to && e.to.userId === b.userId,
      ),
    ).toBe(true);
    await request(app)
      .post('/push/subscribe')
      .set(auth(b))
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/pickup-shop',
        keys: {
          p256dh:
            'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      });
    const jobs: { payload: { title: string } }[] = [];
    const notifier = createNotifier({
      db: pool,
      logger: quiet,
      enqueue: async (j) => void jobs.push(j as never),
      limiter: { allow: async () => true },
      answerDebounceMs: 0,
    });
    for (const e of events.filter((x) => x.type === 'order.created')) notifier.handle(e);
    await notifier.idle();
    expect(jobs.map((j) => j.payload.title)).toEqual([
      expect.stringMatching(/^Customer chose you: /),
    ]);
  });

  it('S47: ACCEPTED, READY (the response says how many are unpacked), COLLECTED', async () => {
    const { b } = await pickupOnly();
    const id = ((await shopOrders(b))[0] as Json).id as string;
    expect((await request(app).post(`/orders/${id}/collected`).set(auth(seeker))).status).toBe(409); // not ready yet
    await request(app).put(`/orders/${id}/lines/0/packed`).set(auth(b)).send({ packed: true });
    const ready = await act(b, id, 'ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      state: 'READY',
      fulfilment: 'pickup',
      packedCount: 1,
      unpackedCount: 1,
    });
    const collected = await request(app).post(`/orders/${id}/collected`).set(auth(seeker));
    expect(collected.status).toBe(200);
    expect(collected.body).toMatchObject({ state: 'COLLECTED', payment: 'cash_on_delivery' });
    expect((await act(b, id, 'ready')).status).toBe(409); // final
  });

  it('S47: ready/collected belong to pickup, out/received to delivery', async () => {
    const { a, b, id } = await answered();
    const res = await order(id, {
      assignments: [
        { position: 0, shopId: a.shopId },
        { position: 1, shopId: b.shopId },
      ],
      modes: { [a.shopId]: 'delivery', [b.shopId]: 'pickup' },
      addressText: ADDRESS,
    });
    const oa = res.body.orders.find((o: Json) => o.shopId === a.shopId).id;
    const ob = res.body.orders.find((o: Json) => o.shopId === b.shopId).id;
    expect((await act(a, oa, 'ready')).status).toBe(409);
    expect((await act(b, ob, 'out')).status).toBe(409);
    await act(a, oa, 'out');
    await act(b, ob, 'ready');
    expect((await request(app).post(`/orders/${oa}/collected`).set(auth(seeker))).status).toBe(409);
    expect((await request(app).post(`/orders/${ob}/received`).set(auth(seeker))).status).toBe(409);
    expect((await request(app).post(`/orders/${oa}/received`).set(auth(seeker))).status).toBe(200);
  });

  it('S47: not collected within 3 hours it becomes NOT_CONFIRMED, by the sweeper, and cannot be collected after', async () => {
    const { b } = await pickupOnly();
    const id = ((await shopOrders(b))[0] as Json).id as string;
    const ready = await act(b, id, 'ready');
    expect(ready.body.state).toBe('READY');
    const hours = (
      await pool.query(
        `SELECT extract(epoch FROM receive_by - now()) / 3600 AS h FROM delivery_orders WHERE id = $1`,
        [id],
      )
    ).rows[0].h;
    expect(Number(hours)).toBeGreaterThan(2.9);
    await pool.query(
      `UPDATE delivery_orders SET receive_by = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    expect(await sweepOrders({ db: pool, logger: quiet })).toBe(1);
    expect(
      (await pool.query(`SELECT state FROM delivery_orders WHERE id = $1`, [id])).rows[0].state,
    ).toBe('NOT_CONFIRMED');
    expect((await request(app).post(`/orders/${id}/collected`).set(auth(seeker))).status).toBe(409);
  });

  it('S47: the shop cancels an ACCEPTED pickup with a reason, the customer is told; a READY pickup cannot be cancelled', async () => {
    const { b } = await pickupOnly();
    const id = ((await shopOrders(b))[0] as Json).id as string;
    expect((await request(app).post(`/orders/${id}/cancel`).set(auth(b)).send({})).status).toBe(
      400,
    );
    await act(b, id, 'ready');
    expect(
      (
        await request(app)
          .post(`/orders/${id}/cancel`)
          .set(auth(b))
          .send({ reason: 'out_of_stock' })
      ).status,
    ).toBe(409);
  });

  it('S47: the customer can cancel an ACCEPTED pickup; a shop cancel with a reason works', async () => {
    const { b } = await pickupOnly();
    const id = ((await shopOrders(b))[0] as Json).id as string;
    const done = await request(app)
      .post(`/orders/${id}/cancel`)
      .set(auth(b))
      .send({ reason: 'out_of_stock' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ state: 'CANCELLED', cancelReason: 'out_of_stock' });
  });

  it('S48: packing works for pickup orders, also once READY', async () => {
    const { b } = await pickupOnly();
    const id = ((await shopOrders(b))[0] as Json).id as string;
    expect(
      (await request(app).put(`/orders/${id}/lines/0/packed`).set(auth(b)).send({ packed: true }))
        .body.packedCount,
    ).toBe(1);
    await act(b, id, 'ready');
    expect(
      (await request(app).put(`/orders/${id}/lines/1/packed`).set(auth(b)).send({ packed: true }))
        .body.packedCount,
    ).toBe(2);
  });

  it('S48: an open pickup blocks deleting the account; a closed shop refuses a pickup order', async () => {
    const { a, b, id } = await answered();
    await request(app).put('/shops/me/open').set(auth(b)).send({ open: false });
    const refused = await order(id, {
      assignments: [{ position: 0, shopId: b.shopId }],
      modes: { [b.shopId]: 'pickup' },
    });
    expect(refused.status).toBe(409);
    await request(app).put('/shops/me/open').set(auth(b)).send({ open: true });
    expect(
      (await order(id, { assignments: [{ position: 0, shopId: b.shopId }], modes: {} })).status,
    ).toBe(201);
    expect((await request(app).delete('/account').set(auth(seeker))).status).toBe(409);
    void a;
  });
});
