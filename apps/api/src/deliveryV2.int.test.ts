import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { sweepOrderAddresses, sweepOrders } from './modules/orders/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

// ADR-0039 (PR J): Delivery v2. The customer ticks "Deliver to me", shops answer with a binding
// offer, the customer picks ONE shop, and the customer confirms receipt. Cash on delivery.
describe('Delivery v2', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_897_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let other: User;
  let shopA: User & { shopId: string };
  let shopB: User & { shopId: string };
  const events: RealtimeEvent[] = [];
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const quiet = pino({ level: 'silent' });
  let realtime: ReturnType<typeof createRealtime>;

  async function newShop(name: string, km: number) {
    const u = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(u))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories: ['grocery'] });
    return { ...u, shopId: made.body.id as string };
  }

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    realtime = createRealtime({ redisUrl: null, logger: quiet });
    realtime.onPublish((e) => events.push(e));
    app = createApp({ config: testConfig(), logger: quiet, db: pool, realtime });
    seeker = await loginAs(app, 'seeker', String(phone++));
    other = await loginAs(app, 'seeker', String(phone++));
    shopA = await newShop('Alpha Kirana', 0.3);
    shopB = await newShop('Beta Kirana', 0.6);
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'requests, pings, shop_stock, delivery_orders, errands, saved_addresses',
    );
    await pool.query(
      `UPDATE shops SET closed_until = NULL, is_simulated = false, delivery_max_km = NULL,
              delivers_default = false, default_fee_paise = NULL, default_minutes = NULL`,
    );
    events.length = 0;
  });

  // ---- helpers ---------------------------------------------------------------------------
  const saveAddress = async (user: User = seeker) =>
    (
      await request(app)
        .put('/orders/saved-address')
        .set(auth(user))
        .send({ addressText: ADDRESS, customerName: 'Asha Verma' })
    ).body.id as string;

  /** Find: a request, optionally "Deliver to me", with every shop pinged. */
  async function find(opts: { wantsDelivery?: boolean; user?: User; addressId?: string } = {}) {
    const user = opts.user ?? seeker;
    const wants = opts.wantsDelivery ?? false;
    const addressId = opts.addressId ?? (wants ? await saveAddress(user) : undefined);
    const made = await request(app)
      .post('/requests')
      .set(auth(user))
      .send({
        q: 'chini',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        ...(wants && { wantsDelivery: true }),
        ...(addressId && { deliveryAddressId: addressId }),
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const requestId = made.body.id as string;
    await fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, requestId, claimsAll);
    return requestId;
  }
  const cards = async (shop: User) =>
    (await request(app).get('/shops/me/pings').set(auth(shop))).body;
  const answer = async (shop: User, body: Record<string, unknown>) => {
    const [card] = await cards(shop);
    return request(app).post(`/pings/${card.id}/answer`).set(auth(shop)).send(body);
  };
  const OFFER = { answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } };
  const age = (minutes: number) =>
    pool.query(`UPDATE pings SET answered_at = answered_at - make_interval(mins => $1)`, [minutes]);
  const order = (user: User, shop: { shopId: string }, requestId: string, over = {}) =>
    request(app)
      .post('/orders')
      .set(auth(user))
      .send({ shopId: shop.shopId, requestId, ...over });
  const act = (user: User, id: string, verb: string, body: Record<string, unknown> = {}) =>
    request(app).post(`/orders/${id}/${verb}`).set(auth(user)).send(body);
  const stateOf = async (id: string) =>
    (await pool.query(`SELECT state FROM delivery_orders WHERE id = $1`, [id])).rows[0]?.state;
  const shopList = (shop: User) => request(app).get('/shops/me/orders').set(auth(shop));

  /** A request where shop A offered delivery just now, with the customer's address on it. */
  async function offered() {
    const requestId = await find({ wantsDelivery: true });
    expect((await answer(shopA, OFFER)).status).toBe(200);
    return requestId;
  }

  // ---- requests: wants_delivery and the address ----------------------------------------------
  describe('Find with "Deliver to me"', () => {
    it('needs an address of the customer’s own when ticked', async () => {
      const bare = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng, wantsDelivery: true });
      expect(bare.status).toBe(400);
      const theirs = await saveAddress(other);
      const stolen = await request(app).post('/requests').set(auth(seeker)).send({
        q: 'chini',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        wantsDelivery: true,
        deliveryAddressId: theirs,
      });
      expect(stolen.status).toBe(400);
    });

    it('stores wants_delivery and the address id on the request, false by default', async () => {
      const plain = await find();
      const wanting = await find({ wantsDelivery: true });
      const rows = (
        await pool.query(`SELECT id, wants_delivery, delivery_address_id FROM requests`)
      ).rows;
      expect(rows.find((r) => r.id === plain)).toMatchObject({
        wants_delivery: false,
        delivery_address_id: null,
      });
      const row = rows.find((r) => r.id === wanting);
      expect(row.wants_delivery).toBe(true);
      expect(row.delivery_address_id).toBeTruthy();
    });
  });

  // ---- the shop's side of a ping -----------------------------------------------------------
  describe('what a shop sees of a ping (S21)', () => {
    it('adds wantsDelivery and canDeliver to the allow-list, and nothing else (lastPricePaise: ADR-0040)', async () => {
      await find({ wantsDelivery: true });
      const [card] = await cards(shopA);
      expect(Object.keys(card).sort()).toEqual(
        [
          'canDeliver',
          'distanceBand',
          'expiresAt',
          'id',
          'item',
          'lastPricePaise',
          'sentAt',
          'wantsDelivery',
        ].sort(),
      );
      expect(card).toMatchObject({ wantsDelivery: true, canDeliver: true });
      expect(JSON.stringify(card)).not.toMatch(/Sapna|Vijay|Flat|Asha|address/i);
    });

    it('wantsDelivery is false when the customer did not tick it', async () => {
      await find();
      expect((await cards(shopA))[0]).toMatchObject({ wantsDelivery: false });
    });

    it('canDeliver is about distance alone: no limit means yes, and a standing offer is not needed', async () => {
      await find({ wantsDelivery: true });
      // shopA has no standing delivery offer and no limit: it can still deliver on a single answer.
      expect((await cards(shopA))[0].canDeliver).toBe(true);
      await pool.query(`UPDATE shops SET delivery_max_km = 0.2 WHERE id = $1`, [shopA.shopId]);
      expect((await cards(shopA))[0].canDeliver).toBe(false);
      await pool.query(`UPDATE shops SET delivery_max_km = 0.5 WHERE id = $1`, [shopA.shopId]);
      expect((await cards(shopA))[0].canDeliver).toBe(true);
    });

    it('rejects a delivery offer when the customer is out of range; yes without delivery still works', async () => {
      await find({ wantsDelivery: true });
      await pool.query(`UPDATE shops SET delivery_max_km = 0.1 WHERE id = $1`, [shopA.shopId]);
      const refused = await answer(shopA, OFFER);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('cannot_deliver');
      expect((await answer(shopA, { answer: 'yes', pricePaise: 4500 })).status).toBe(200);
    });

    it('a shop sets its limit with PATCH /shops/me, and null removes it', async () => {
      const set = await request(app)
        .patch('/shops/me')
        .set(auth(shopA))
        .send({ delivery: { feePaise: 2000, minutes: 30 }, deliveryMaxKm: 2.5 });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ deliveryMaxKm: 2.5, defaultFeePaise: 2000 });
      const cleared = await request(app)
        .patch('/shops/me')
        .set(auth(shopA))
        .send({ deliveryMaxKm: null });
      expect(cleared.body.deliveryMaxKm).toBeNull();
      expect(cleared.body.defaultFeePaise).toBe(2000);
    });
  });

  // ---- the binding offer ---------------------------------------------------------------------
  describe('S17: a fresh offer is binding', () => {
    it('starts the order ACCEPTED and tells the shop the customer chose it', async () => {
      const requestId = await offered();
      const res = await order(seeker, shopA, requestId);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ state: 'ACCEPTED', feePaise: 3000, feeMinutes: 45 });
      expect(res.body.addressText).toBe(ADDRESS);
      expect(events).toContainEqual(
        expect.objectContaining({
          to: { userId: shopA.userId },
          type: 'order.created',
          data: expect.objectContaining({ orderId: res.body.id }),
        }),
      );
      expect((await shopList(shopA)).body[0]).toMatchObject({
        state: 'ACCEPTED',
        addressText: ADDRESS,
      });
    });

    it('never from learned stock: that is only what the shop said earlier', async () => {
      const first = await offered();
      await order(seeker, shopA, first).then((r) => act(seeker, r.body.id, 'cancel'));
      const second = await find({ wantsDelivery: true, user: other });
      await pool.query(`DELETE FROM pings WHERE request_id = $1`, [second]);
      const res = await order(other, shopA, second);
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('REQUESTED');
    });
  });

  describe('S18: an old offer still needs the shop to accept', () => {
    it('an offer older than 30 minutes starts REQUESTED, and the shop has 10 minutes', async () => {
      const requestId = await offered();
      await age(31);
      const res = await order(seeker, shopA, requestId);
      expect(res.body.state).toBe('REQUESTED');
      expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
      expect(Date.parse(res.body.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
      expect((await shopList(shopA)).body[0]).not.toHaveProperty('addressText');
    });

    it('an offer 29 minutes old is still binding', async () => {
      const requestId = await offered();
      await age(29);
      expect((await order(seeker, shopA, requestId)).body.state).toBe('ACCEPTED');
    });

    it('a request that is no longer open does not make a binding order', async () => {
      const requestId = await offered();
      await pool.query(`UPDATE requests SET state = 'CLOSED' WHERE id = $1`, [requestId]);
      expect((await order(seeker, shopA, requestId)).body.state).toBe('REQUESTED');
    });

    it('a closed shop takes no new order at all (S3 stands)', async () => {
      const requestId = await offered();
      await pool.query(`UPDATE shops SET closed_until = now() + interval '1 hour' WHERE id = $1`, [
        shopA.shopId,
      ]);
      const res = await order(seeker, shopA, requestId);
      expect(res.status).toBe(409);
      expect(await pool.query(`SELECT 1 FROM delivery_orders`).then((r) => r.rowCount)).toBe(0);
    });
  });

  // ---- one shop only -----------------------------------------------------------------------
  describe('S16: the customer picks ONE shop', () => {
    async function twoOffers() {
      const requestId = await find({ wantsDelivery: true });
      // Both shops have the question open and answer at the same moment (S5): the first yes
      // answers the request, the second is kept as well.
      const [a] = await cards(shopA);
      const [b] = await cards(shopB);
      for (const [shop, card, price] of [
        [shopA, a, 4500],
        [shopB, b, 4000],
      ] as const)
        expect(
          (
            await request(app)
              .post(`/pings/${card.id}/answer`)
              .set(auth(shop))
              .send({ ...OFFER, pricePaise: price })
          ).status,
        ).toBe(200);
      return requestId;
    }

    it('only the chosen shop gets the order; the other gets the "customer got an answer" note', async () => {
      const requestId = await twoOffers();
      events.length = 0;
      const res = await order(seeker, shopB, requestId);
      expect(res.body.state).toBe('ACCEPTED');
      expect((await shopList(shopB)).body).toHaveLength(1);
      expect((await shopList(shopA)).body).toHaveLength(0);
      expect(events).toContainEqual(
        expect.objectContaining({
          to: { userId: shopA.userId },
          type: 'ping.closed',
          data: expect.objectContaining({ reason: 'customer_chose' }),
        }),
      );
      expect(
        events.some(
          (e) => 'userId' in e.to && e.to.userId === shopB.userId && e.type === 'ping.closed',
        ),
      ).toBe(false);
    });

    it('a second order on the same request is refused with a clear message', async () => {
      const requestId = await twoOffers();
      expect((await order(seeker, shopA, requestId)).status).toBe(201);
      const second = await order(seeker, shopB, requestId);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('already_ordered');
      expect(second.body.error.message).toBe("You've already ordered this from another shop");
    });

    it('two taps at once on two shops: exactly one order, the other is told 409', async () => {
      const requestId = await twoOffers();
      const [a, b] = await Promise.all([
        order(seeker, shopA, requestId),
        order(seeker, shopB, requestId),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe('already_ordered');
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM delivery_orders WHERE state <> 'CANCELLED'`,
          )
        ).rows[0].n,
      ).toBe(1);
    });

    it('after the first order ends (declined, cancelled) the customer may pick another shop', async () => {
      const requestId = await twoOffers();
      const first = await order(seeker, shopA, requestId);
      await act(seeker, first.body.id, 'cancel');
      expect((await order(seeker, shopB, requestId)).status).toBe(201);
    });

    it('an errand with two shops still works: the rule is for a request’s own orders', async () => {
      const requestId = await twoOffers();
      const errand = (
        await pool.query<{ id: string }>(
          `INSERT INTO errands (user_id, task, location, state)
           SELECT user_id, 'school things', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'PLAN_READY'
             FROM requests WHERE id = $1 RETURNING id`,
          [requestId, ORIGIN.lng, ORIGIN.lat],
        )
      ).rows[0]?.id as string;
      const insert = (shopId: string) =>
        pool.query(
          `INSERT INTO delivery_orders (user_id, shop_id, errand_id, source_id, state, lines, address_text, lat, lng, expires_at)
           SELECT user_id, $2, $1, $1, 'ACCEPTED', '[]'::jsonb, 'x y z w v', 1, 1, now() + interval '1 hour'
             FROM errands WHERE id = $1`,
          [errand, shopId],
        );
      await insert(shopA.shopId);
      await insert(shopB.shopId);
      expect((await pool.query(`SELECT count(*)::int AS n FROM delivery_orders`)).rows[0].n).toBe(
        2,
      );
    });
  });

  // ---- the address ---------------------------------------------------------------------------
  describe('S21: the address', () => {
    it('is on no shop view before ACCEPTED, and shown after', async () => {
      const requestId = await find({ wantsDelivery: true });
      await answer(shopA, OFFER);
      await age(31);
      const placed = await order(seeker, shopA, requestId);
      expect(placed.body.state).toBe('REQUESTED');
      const before = JSON.stringify([
        (await shopList(shopA)).body,
        (await request(app).get('/shops/me/pings').set(auth(shopA))).body,
        (await request(app).get('/shops/me').set(auth(shopA))).body,
      ]);
      expect(before).not.toMatch(/Sapna|Vijay|Flat 4B/);
      await act(shopA, placed.body.id, 'accept');
      expect(JSON.stringify((await shopList(shopA)).body)).toContain('Sapna');
    });

    it('the shop saw wantsDelivery on the ping before it answered', async () => {
      await find({ wantsDelivery: true });
      expect((await cards(shopA))[0].wantsDelivery).toBe(true);
    });

    it('is copied onto the order, so forgetting the saved address later changes nothing', async () => {
      const requestId = await offered();
      const placed = await order(seeker, shopA, requestId);
      await request(app).delete('/orders/saved-address').set(auth(seeker));
      expect(
        (await request(app).get(`/orders/${placed.body.id}`).set(auth(seeker))).body,
      ).toMatchObject({
        addressText: ADDRESS,
      });
    });

    it('asks for addressText when the saved address is gone by the time the customer orders', async () => {
      const requestId = await offered();
      await request(app).delete('/orders/saved-address').set(auth(seeker));
      const without = await order(seeker, shopA, requestId);
      expect(without.status).toBe(400);
      expect(without.body.error.code).toBe('address_required');
      const typed = await order(seeker, shopA, requestId, {
        addressText: 'Shop 9, Palasia, Indore',
      });
      expect(typed.status).toBe(201);
      expect(typed.body.addressText).toBe('Shop 9, Palasia, Indore');
    });

    it('a customer who did not tick still orders with a typed address when a shop offers delivery', async () => {
      const requestId = await find();
      await answer(shopA, OFFER);
      const res = await order(seeker, shopA, requestId, { addressText: ADDRESS });
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('ACCEPTED');
    });
  });

  describe('the note', () => {
    it('is kept up to 140 characters with phone numbers removed, and the shop sees it', async () => {
      const requestId = await offered();
      const res = await order(seeker, shopA, requestId, {
        note: 'Gate 2, call +91 98765 43210 or 9876543210',
      });
      expect(res.body.note).toMatch(/^Gate 2, call/);
      expect(res.body.note).not.toMatch(/\d{5}/);
      expect((await shopList(shopA)).body[0].note).toBe(res.body.note);
    });

    it('longer than 140 characters is refused', async () => {
      const requestId = await offered();
      expect((await order(seeker, shopA, requestId, { note: 'x'.repeat(141) })).status).toBe(400);
    });
  });

  // ---- after the pick ------------------------------------------------------------------------
  describe('out for delivery and Received', () => {
    async function outForDelivery() {
      const placed = await order(seeker, shopA, await offered());
      const id = placed.body.id as string;
      expect((await act(shopA, id, 'out')).body.state).toBe('OUT_FOR_DELIVERY');
      return id;
    }

    it('stores out_for_delivery_at and a receive deadline 3 hours later', async () => {
      const id = await outForDelivery();
      const row = (
        await pool.query(
          `SELECT out_for_delivery_at, receive_by,
                  extract(epoch FROM receive_by - out_for_delivery_at) AS secs
             FROM delivery_orders WHERE id = $1`,
          [id],
        )
      ).rows[0];
      expect(row.out_for_delivery_at).not.toBeNull();
      expect(Number(row.secs)).toBe(3 * 3600);
    });

    it('records accepted_at when the shop accepts and shows it with the dispatch time', async () => {
      const id = await outForDelivery();
      const row = (
        await pool.query('SELECT accepted_at, out_for_delivery_at FROM delivery_orders WHERE id = $1', [
          id,
        ])
      ).rows[0];
      expect(row.accepted_at).not.toBeNull();
      const view = (await act(seeker, id, 'received')).body;
      expect(typeof view.acceptedAt).toBe('string');
      expect(typeof view.outForDeliveryAt).toBe('string');
    });

    it('only the customer can mark it received; the shop has no Delivered any more', async () => {
      const id = await outForDelivery();
      expect((await act(shopA, id, 'delivered')).status).toBe(404);
      expect((await act(shopA, id, 'received')).status).toBe(403);
      expect((await act(other, id, 'received')).status).toBe(404);
      const done = await act(seeker, id, 'received');
      expect(done.body.state).toBe('DELIVERED');
      expect((await act(seeker, id, 'received')).body.state).toBe('DELIVERED'); // a repeat tap
    });

    it('cannot be received before the shop has set out', async () => {
      const placed = await order(seeker, shopA, await offered());
      expect((await act(seeker, placed.body.id, 'received')).status).toBe(409);
    });
  });

  describe('S19: no Received for 3 hours', () => {
    async function overdue() {
      const placed = await order(seeker, shopA, await offered());
      const id = placed.body.id as string;
      await act(shopA, id, 'out');
      await pool.query(
        `UPDATE delivery_orders SET receive_by = now() - interval '1 second' WHERE id = $1`,
        [id],
      );
      return id;
    }

    it('the sweeper moves it to NOT_CONFIRMED, never DELIVERED, and the customer can no longer receive', async () => {
      const id = await overdue();
      expect(await sweepOrders({ db: pool, logger: quiet, events: realtime.events })).toBe(1);
      expect(await stateOf(id)).toBe('NOT_CONFIRMED');
      expect((await act(seeker, id, 'received')).status).toBe(409);
      expect(await stateOf(id)).toBe('NOT_CONFIRMED');
    });

    it('is not moved before the deadline', async () => {
      const placed = await order(seeker, shopA, await offered());
      await act(shopA, placed.body.id, 'out');
      await sweepOrders({ db: pool, logger: quiet, events: realtime.events });
      expect(await stateOf(placed.body.id)).toBe('OUT_FOR_DELIVERY');
    });

    it('whoever looks first moves it: a read does too', async () => {
      const id = await overdue();
      const seen = await request(app).get(`/orders/${id}`).set(auth(seeker));
      expect(seen.body.state).toBe('NOT_CONFIRMED');
    });

    it('a Received racing the sweep leaves exactly one outcome', async () => {
      const id = await overdue();
      const [, received] = await Promise.all([
        sweepOrders({ db: pool, logger: quiet, events: realtime.events }),
        act(seeker, id, 'received'),
      ]);
      // Past the deadline the order is NOT_CONFIRMED, whoever looked first.
      expect(await stateOf(id)).toBe('NOT_CONFIRMED');
      expect([200, 409]).toContain(received.status);
    });

    it('its address is cleared after 30 days like any final order', async () => {
      const id = await overdue();
      await sweepOrders({ db: pool, logger: quiet, events: realtime.events });
      await pool.query(
        `UPDATE delivery_orders SET updated_at = now() - interval '31 days' WHERE id = $1`,
        [id],
      );
      await sweepOrderAddresses({ db: pool, logger: quiet });
      expect(
        (await pool.query(`SELECT address_text, lat FROM delivery_orders WHERE id = $1`, [id]))
          .rows[0],
      ).toEqual({ address_text: null, lat: null });
    });

    it('the customer sees the state to tell them they did not confirm', async () => {
      const id = await overdue();
      await sweepOrders({ db: pool, logger: quiet, events: realtime.events });
      const mine = await request(app).get('/orders').set(auth(seeker));
      expect(mine.body[0]).toMatchObject({ id, state: 'NOT_CONFIRMED' });
    });
  });

  describe('S20: cancelling', () => {
    async function accepted() {
      const placed = await order(seeker, shopA, await offered());
      return placed.body.id as string;
    }

    it('a shop cancels an ACCEPTED order with a reason, and the customer is told', async () => {
      const id = await accepted();
      events.length = 0;
      const res = await act(shopA, id, 'cancel', { reason: 'out_of_stock' });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('CANCELLED');
      expect(events).toContainEqual(
        expect.objectContaining({
          to: { userId: seeker.userId },
          type: 'order.updated',
          data: expect.objectContaining({ orderId: id, state: 'CANCELLED' }),
        }),
      );
      expect((await request(app).get(`/orders/${id}`).set(auth(seeker))).body).toMatchObject({
        cancelledBy: 'shop',
        cancelReason: 'out_of_stock',
      });
    });

    it('needs a reason from the list; "other" may carry up to 140 characters of text', async () => {
      const id = await accepted();
      expect((await act(shopA, id, 'cancel')).status).toBe(400);
      expect((await act(shopA, id, 'cancel', { reason: 'bored' })).status).toBe(400);
      expect(
        (await act(shopA, id, 'cancel', { reason: 'other', text: 'x'.repeat(141) })).status,
      ).toBe(400);
      const ok = await act(shopA, id, 'cancel', { reason: 'other', text: 'Rider fell ill' });
      expect(ok.body.state).toBe('CANCELLED');
      expect((await request(app).get(`/orders/${id}`).set(auth(seeker))).body.cancelText).toBe(
        'Rider fell ill',
      );
    });

    it('cannot cancel after OUT_FOR_DELIVERY, and not from REQUESTED', async () => {
      const id = await accepted();
      await act(shopA, id, 'out');
      const late = await act(shopA, id, 'cancel', { reason: 'cannot_deliver_now' });
      expect(late.status).toBe(409);
      expect(await stateOf(id)).toBe('OUT_FOR_DELIVERY');

      const requestId = await find({ wantsDelivery: true });
      await answer(shopB, OFFER);
      await age(31);
      const waiting = await order(seeker, shopB, requestId);
      expect(waiting.body.state).toBe('REQUESTED');
      expect((await act(shopB, waiting.body.id, 'cancel', { reason: 'other' })).status).toBe(409);
    });

    it('another shop’s order is a 404 for a shop', async () => {
      const id = await accepted();
      expect((await act(shopB, id, 'cancel', { reason: 'other' })).status).toBe(404);
    });

    it('the customer still cancels REQUESTED or ACCEPTED, with an optional reason', async () => {
      const requestId = await offered();
      const id = (await order(seeker, shopA, requestId)).body.id as string;
      const res = await act(seeker, id, 'cancel', { reason: 'changed my mind' });
      expect(res.body.state).toBe('CANCELLED');
      expect(res.body.cancelledBy).toBe('customer');
      const again = await order(seeker, shopA, requestId);
      expect((await act(seeker, again.body.id, 'cancel')).body.state).toBe('CANCELLED');
    });

    it('is decided by who the caller is to THIS order, not by a global role', async () => {
      const id = await accepted();
      // The customer who also owns the shop they ordered from: neither side is clear, so refuse.
      await pool.query(`UPDATE shops SET owner_user_id = $2 WHERE id = $1`, [
        shopA.shopId,
        seeker.userId,
      ]);
      const both = await act(seeker, id, 'cancel', { reason: 'other' });
      expect(both.status).toBe(409);
      expect(await stateOf(id)).toBe('ACCEPTED');
      await pool.query(`UPDATE shops SET owner_user_id = $2 WHERE id = $1`, [
        shopA.shopId,
        shopA.userId,
      ]);
    });
  });
});
