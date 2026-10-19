import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { sweepOrders } from './modules/orders/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

// ADR-0031 (PR D): delivery orders. Cash on delivery; the address lives only on the order.
describe('delivery orders', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_896_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let other: User;
  let shop: User & { shopId: string };
  let rival: User & { shopId: string };
  const logs: string[] = [];
  const events: RealtimeEvent[] = [];
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const logger = pino(
    { level: 'trace' },
    {
      write(line: string) {
        logs.push(line);
      },
    },
  );
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
    realtime = createRealtime({ redisUrl: null, logger });
    realtime.onPublish((e) => events.push(e));
    app = createApp({
      config: testConfig({ errandFewerStopsMaxExtraPaise: 1000 }),
      logger,
      db: pool,
      realtime,
    });
    seeker = await loginAs(app, 'seeker', String(phone++));
    other = await loginAs(app, 'seeker', String(phone++));
    shop = await newShop('Order Kirana', 0.3);
    rival = await newShop('Rival Kirana', 0.6);
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
    logs.length = 0;
    events.length = 0;
  });

  // ---- a request answered with a yes that offers delivery -------------------------------
  async function answeredRequest(
    answerer: User = shop,
    delivery: Record<string, unknown> | null = { feePaise: 3000, minutes: 45 },
    fresh = false,
  ) {
    const made = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng });
    const requestId = made.body.id as string;
    await fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, requestId, claimsAll);
    const pings = (await request(app).get('/shops/me/pings').set(auth(answerer))).body;
    await request(app)
      .post(`/pings/${pings[0].id}/answer`)
      .set(auth(answerer))
      .send({ answer: 'yes', pricePaise: 4500, ...(delivery && { delivery }) });
    // A fresh offer (under 30 minutes) is binding and starts ACCEPTED (Delivery v2); these tests
    // are about the older flow, where the shop still has ten minutes to accept.
    if (!fresh)
      await pool.query(`UPDATE pings SET answered_at = answered_at - interval '31 minutes'`);
    return requestId;
  }
  const order = (user: User, body: Record<string, unknown>) =>
    request(app).post('/orders').set(auth(user)).send(body);
  const place = (requestId: string, over: Record<string, unknown> = {}) =>
    order(seeker, { shopId: shop.shopId, requestId, addressText: ADDRESS, ...over });
  const act = (user: User, id: string, verb: string) =>
    request(app).post(`/orders/${id}/${verb}`).set(auth(user));
  const shopList = (user: User = shop) => request(app).get('/shops/me/orders').set(auth(user));
  const stateOf = async (id: string) =>
    (await pool.query(`SELECT state FROM delivery_orders WHERE id = $1`, [id])).rows[0]?.state;

  describe('placing an order', () => {
    it('from a result card whose shop said yes with delivery', async () => {
      const requestId = await answeredRequest();
      const res = await place(requestId, { customerName: 'Asha Verma' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        state: 'REQUESTED',
        shopId: shop.shopId,
        shopName: 'Order Kirana',
        feePaise: 3000,
        feeMinutes: 45,
        itemsTotalPaise: 4500,
        payment: 'cash_on_delivery',
        addressText: ADDRESS,
        pickupFallback: false,
      });
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0]).toMatchObject({ count: 1, pricePaise: 4500 });
      expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
      expect(Date.parse(res.body.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    });

    it("keeps the customer's own word and the Hindi name on each line; the shop sees only the name (PR H)", async () => {
      const requestId = await answeredRequest();
      const res = await place(requestId);
      expect(res.body.lines[0]).toMatchObject({
        name: 'sugar',
        nameHi: expect.stringMatching(/[ऀ-ॿ]/),
        text: 'chini',
      });
      const seen = (await shopList()).body[0].lines[0];
      expect(seen).toEqual({ name: 'sugar', count: 1, pricePaise: 4500 });
    });

    it('is refused if the shop did not offer delivery, did not answer, or the request is not yours', async () => {
      const noDelivery = await answeredRequest(shop, null);
      const res = await place(noDelivery);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('no_delivery_offer');

      await truncateKeepingShops(pool, 'requests, pings, shop_stock'); // the shop is asked again
      const answered = await answeredRequest();
      const silent = await order(seeker, {
        shopId: rival.shopId,
        requestId: answered,
        addressText: ADDRESS,
      });
      expect(silent.status).toBe(409);

      const theirs = await order(other, {
        shopId: shop.shopId,
        requestId: answered,
        addressText: ADDRESS,
      });
      expect(theirs.status).toBe(404);
      expect(await pool.query(`SELECT 1 FROM delivery_orders`).then((r) => r.rowCount)).toBe(0);
    });

    it('is refused while the shop is closed', async () => {
      const requestId = await answeredRequest();
      await request(app).put('/shops/me/open').set(auth(shop)).send({ open: false });
      const res = await place(requestId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('shop_closed');
    });

    it('is for a customer only, with a real address and exactly one source', async () => {
      const requestId = await answeredRequest();
      expect(
        (await order(shop, { shopId: shop.shopId, requestId, addressText: ADDRESS })).status,
      ).toBe(403);
      expect((await request(app).post('/orders').send({})).status).toBe(401);
      for (const body of [
        { shopId: shop.shopId, requestId },
        { shopId: shop.shopId, requestId, addressText: '   ' },
        { shopId: shop.shopId, requestId, addressText: 'ab' },
        { shopId: shop.shopId, requestId, addressText: 'x'.repeat(301) },
        { shopId: shop.shopId, addressText: ADDRESS },
        { shopId: shop.shopId, requestId, errandId: requestId, addressText: ADDRESS },
        { requestId, addressText: ADDRESS },
        { shopId: 'not-a-uuid', requestId, addressText: ADDRESS },
      ]) {
        const res = await order(seeker, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('placing it twice while it is open returns the same order', async () => {
      const requestId = await answeredRequest();
      const first = await place(requestId);
      const again = await place(requestId);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect((await pool.query(`SELECT 1 FROM delivery_orders`)).rowCount).toBe(1);
    });

    it('keeps only the first name for the contact line', async () => {
      const requestId = await answeredRequest();
      const res = await place(requestId, { customerName: '  Asha   Verma ' });
      await act(shop, res.body.id, 'accept');
      expect((await shopList()).body[0].contactName).toBe('Asha');
    });
  });

  describe('the shop answers', () => {
    it('sees a new order without the address, and with "Grahak" as the contact', async () => {
      const placed = await place(await answeredRequest());
      const list = await shopList();
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        id: placed.body.id,
        state: 'REQUESTED',
        contactName: 'Customer',
        feePaise: 3000,
        itemsTotalPaise: 4500,
      });
      expect(list.body[0]).not.toHaveProperty('addressText');
      expect(list.body[0]).not.toHaveProperty('mapUrl');
      expect(JSON.stringify(list.body)).not.toContain('Sapna');
      expect(JSON.stringify(list.body)).not.toContain(String(ORIGIN.lat));
    });

    it('sees the address and a map link only after accepting', async () => {
      const placed = await place(await answeredRequest());
      const res = await act(shop, placed.body.id, 'accept');
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('ACCEPTED');
      expect(res.body.addressText).toBe(ADDRESS);
      expect(res.body.mapUrl).toBe(
        `https://www.google.com/maps/search/?api=1&query=${ORIGIN.lat},${ORIGIN.lng}`,
      );
      const list = await shopList();
      expect(list.body[0]).toMatchObject({ state: 'ACCEPTED', addressText: ADDRESS });
      expect(JSON.stringify(list.body)).not.toMatch(/phone|\+91/);
    });

    it('walks accepted → out for delivery → received by the customer, and the customer follows it', async () => {
      const placed = await place(await answeredRequest());
      const id = placed.body.id as string;
      expect((await act(shop, id, 'accept')).body.state).toBe('ACCEPTED');
      expect((await act(shop, id, 'out')).body.state).toBe('OUT_FOR_DELIVERY');
      expect((await request(app).get(`/orders/${id}`).set(auth(seeker))).body.state).toBe(
        'OUT_FOR_DELIVERY',
      );
      expect((await act(shop, id, 'delivered')).status).toBe(404);
      const done = await act(seeker, id, 'received');
      expect(done.body).toMatchObject({ state: 'DELIVERED', addressText: ADDRESS });
      expect((await request(app).get(`/orders/${id}`).set(auth(seeker))).body.state).toBe(
        'DELIVERED',
      );
    });

    it('cannot skip a step; a repeated tap is harmless', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      const early = await act(seeker, id, 'received');
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('invalid_transition');
      expect((await act(shop, id, 'out')).status).toBe(409);
      expect((await act(shop, id, 'accept')).status).toBe(200);
      const again = await act(shop, id, 'accept');
      expect(again.status).toBe(200);
      expect(again.body.state).toBe('ACCEPTED');
      expect((await act(shop, id, 'decline')).status).toBe(409);
    });

    it('two taps at once on Accept and Decline: exactly one wins', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      const [a, d] = await Promise.all([act(shop, id, 'accept'), act(shop, id, 'decline')]);
      expect([a.status, d.status].sort()).toEqual([200, 409]);
      expect(['ACCEPTED', 'DECLINED']).toContain(await stateOf(id));
    });

    it('only that shop’s owner can see or answer it', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      expect((await act(rival, id, 'accept')).status).toBe(404);
      expect((await act(seeker, id, 'accept')).status).toBe(403);
      expect((await shopList(rival)).body).toEqual([]);
      expect((await shopList(seeker)).status).toBe(403);
      expect((await request(app).get('/shops/me/orders')).status).toBe(401);
      expect(await stateOf(id)).toBe('REQUESTED');
    });

    it('a declined order never shows the address to the shop', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      expect((await act(shop, id, 'decline')).body.state).toBe('DECLINED');
      const declined = (await shopList()).body[0];
      expect(declined.state).toBe('DECLINED');
      expect(declined).not.toHaveProperty('addressText');
      expect(declined).not.toHaveProperty('mapUrl');
    });
  });

  describe('the customer', () => {
    it('reads their own orders, by id or by what they came from; others get 404', async () => {
      const requestId = await answeredRequest();
      const id = (await place(requestId)).body.id as string;
      expect((await request(app).get(`/orders/${id}`).set(auth(seeker))).status).toBe(200);
      expect((await request(app).get(`/orders/${id}`).set(auth(other))).status).toBe(404);
      expect((await request(app).get(`/orders/${id}`).set(auth(shop))).status).toBe(403);
      const list = await request(app).get('/orders').query({ requestId }).set(auth(seeker));
      expect(list.body.map((o: { id: string }) => o.id)).toEqual([id]);
      const nobody = await request(app).get('/orders').query({ requestId }).set(auth(other));
      expect(nobody.body).toEqual([]);
      // Both at once is a mistake; none at all is "Mere orders" (ADR-0033).
      const both = await request(app)
        .get('/orders')
        .query({ requestId, errandId: requestId })
        .set(auth(seeker));
      expect(both.status).toBe(400);
    });

    it('can cancel while it is REQUESTED or ACCEPTED, not once it is out', async () => {
      const requestId = await answeredRequest();
      const first = (await place(requestId)).body.id as string;
      expect((await act(other, first, 'cancel')).status).toBe(404);
      expect((await act(seeker, first, 'cancel')).body.state).toBe('CANCELLED');

      const second = (await place(requestId)).body.id as string;
      await act(shop, second, 'accept');
      expect((await act(seeker, second, 'cancel')).body.state).toBe('CANCELLED');
      const cancelled = (await shopList()).body.find((o: { id: string }) => o.id === second);
      expect(cancelled).not.toHaveProperty('addressText');

      const third = (await place(requestId)).body.id as string;
      await act(shop, third, 'accept');
      await act(shop, third, 'out');
      const late = await act(seeker, third, 'cancel');
      expect(late.status).toBe(409);
      expect(await stateOf(third)).toBe('OUT_FOR_DELIVERY');
    });

    it('is offered a saved address only if they ticked it, and nobody else’s', async () => {
      const empty = await request(app).get('/orders/saved-address').set(auth(seeker));
      expect(empty.body).toEqual({ id: null, addressText: null, customerName: null });
      await place(await answeredRequest(), { customerName: 'Asha' });
      const untouched = await request(app).get('/orders/saved-address').set(auth(seeker));
      expect(untouched.body).toEqual({ id: null, addressText: null, customerName: null });
      await pool.query(`UPDATE delivery_orders SET state = 'CANCELLED'`);
      await pool.query('DELETE FROM shop_stock'); // asked again, not answered from memory
      await place(await answeredRequest(), { customerName: 'Asha', saveAddress: true });
      const saved = await request(app).get('/orders/saved-address').set(auth(seeker));
      expect(saved.body).toEqual({
        id: expect.any(String),
        addressText: ADDRESS,
        customerName: 'Asha',
      });
      const theirs = await request(app).get('/orders/saved-address').set(auth(other));
      expect(theirs.body).toEqual({ id: null, addressText: null, customerName: null });
      expect((await request(app).get('/orders/saved-address').set(auth(shop))).status).toBe(403);
    });
  });

  describe('no answer in 10 minutes', () => {
    it('expires on the next look, tells the customer it is pickup, and shows the shop no address', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      await pool.query(
        `UPDATE delivery_orders SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [id],
      );
      const list = await shopList();
      expect(list.body[0].state).toBe('EXPIRED');
      expect(list.body[0]).not.toHaveProperty('addressText');
      const mine = await request(app).get(`/orders/${id}`).set(auth(seeker));
      expect(mine.body).toMatchObject({ state: 'EXPIRED', pickupFallback: true });
      expect((await act(shop, id, 'accept')).status).toBe(409);
    });

    it('the sweeper expires overdue orders and says so to both sides', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      await pool.query(
        `UPDATE delivery_orders SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [id],
      );
      events.length = 0;
      expect(await sweepOrders({ db: pool, logger: quiet, events: realtime.events })).toBe(1);
      expect(await stateOf(id)).toBe('EXPIRED');
      expect(
        events
          .filter((e) => e.type === 'order.updated')
          .map((e) => ('userId' in e.to ? e.to.userId : ''))
          .sort(),
      ).toEqual([seeker.userId, shop.userId].sort());
      expect(await sweepOrders({ db: pool, logger: quiet })).toBe(0);
    });

    it('an accepted order does not expire', async () => {
      const id = (await place(await answeredRequest())).body.id as string;
      await act(shop, id, 'accept');
      await pool.query(
        `UPDATE delivery_orders SET expires_at = now() - interval '1 hour' WHERE id = $1`,
        [id],
      );
      expect(await sweepOrders({ db: pool, logger: quiet })).toBe(0);
      expect(await stateOf(id)).toBe('ACCEPTED');
    });
  });

  describe('from a plan card, with the fall back to pickup', () => {
    const A = '00000000-0000-4000-8000-00000000000a';
    const C = '00000000-0000-4000-8000-00000000000c';
    const stop = (shopId: string, label: string, km: number) => ({
      shopId,
      label,
      lat: north(km),
      lng: ORIGIN.lng,
    });
    const row = (
      shopId: string,
      shopName: string,
      text: string,
      price: number,
      delivery: unknown,
    ) => ({
      text,
      itemId: `item-${text}`,
      itemName: text,
      quantity: 1,
      status: 'confirmed',
      shopId,
      shopName,
      distanceM: 500,
      pricePaise: price,
      referencePricePaise: null,
      photoId: null,
      freshness: 'Confirmed just now',
      downgraded: null,
      matchedAs: false,
      delivery,
      offeredQuantity: null,
      quantityCheck: null,
    });
    const variant = (
      kind: string,
      items: unknown[],
      stops: ReturnType<typeof stop>[],
      total: number,
    ) => ({
      kind,
      items,
      route: { orderedStops: stops, legsM: stops.map(() => 500), totalM: stops.length * 500 },
      totalPricePaise: total,
      comparablePricePaise: total,
      unknownPriceCount: 0,
      totalDistanceM: stops.length * 500,
      shopCount: stops.length,
      savingsPaise: 0,
    });
    const offer = { feePaise: 0, minutes: 30 };
    let errandId: string;
    beforeEach(async () => {
      const B = shop.shopId;
      // sasta: 3 shops, ₹100. kam_dukaan: 2 shops, ₹120 (₹20 more).
      const sasta = variant(
        'sasta',
        [
          row(A, 'A', 'daal', 3000, null),
          row(B, 'B', 'chini', 4000, offer),
          row(C, 'C', 'namak', 3000, null),
        ],
        [stop(A, 'A', 0.2), stop(B, 'B', 0.3), stop(C, 'C', 0.5)],
        10000,
      );
      const kam = variant(
        'kam_dukaan',
        [
          row(A, 'A', 'daal', 3000, null),
          row(B, 'B', 'chini', 4000, offer),
          row(B, 'B', 'namak', 5000, offer),
        ],
        [stop(A, 'A', 0.2), stop(B, 'B', 0.3)],
        12000,
      );
      const plan = {
        items: sasta.items,
        route: sasta.route,
        totalPricePaise: 10000,
        savingsPaise: 0,
        plans: { sasta, kam_dukaan: kam },
        recommended: 'sasta',
        recommendation: { extraPaise: 2000, stopsSaved: 1, reason: 'costs_more' },
      };
      errandId = (
        await pool.query<{ id: string }>(
          `INSERT INTO errands (user_id, task, location, state, plan)
           VALUES ($1, 't', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'PLAN_READY', $4::jsonb)
           RETURNING id`,
          [seeker.userId, ORIGIN.lng, ORIGIN.lat, JSON.stringify(plan)],
        )
      ).rows[0]?.id as string;
    });
    const errandOrder = (over: Record<string, unknown> = {}) =>
      order(seeker, { shopId: shop.shopId, errandId, addressText: ADDRESS, ...over });
    const errandView = async () =>
      (await request(app).get(`/errands/${errandId}`).set(auth(seeker))).body;

    it('takes the shop’s lines and fee from the plan, and marks the shop as delivery there', async () => {
      const res = await errandOrder();
      expect(res.status).toBe(201);
      expect(res.body.lines.map((l: { name: string }) => l.name)).toContain('chini');
      expect(res.body).toMatchObject({ feePaise: 0, errandId });
      expect((await errandView()).plan.modes).toEqual({ [shop.shopId]: 'delivery' });
    });

    it("takes the customer's own word for the line from the plan (PR H)", async () => {
      const res = await errandOrder();
      expect(res.body.lines.every((l: { text?: string }) => typeof l.text === 'string')).toBe(true);
    });

    it('is refused for a shop that is not in the plan or did not offer delivery, or for someone else’s errand', async () => {
      expect((await errandOrder({ shopId: rival.shopId })).status).toBe(409);
      expect((await errandOrder({ shopId: A })).status).toBe(409);
      expect(
        (await order(other, { shopId: shop.shopId, errandId, addressText: ADDRESS })).status,
      ).toBe(404);
      expect((await pool.query(`SELECT 1 FROM delivery_orders`)).rowCount).toBe(0);
    });

    it('a decline turns the shop back to pickup and the customer is told', async () => {
      const id = (await errandOrder()).body.id as string;
      expect((await act(shop, id, 'decline')).body.state).toBe('DECLINED');
      expect((await errandView()).plan.modes).toEqual({});
      const mine = await request(app).get('/orders').query({ errandId }).set(auth(seeker));
      expect(mine.body[0]).toMatchObject({ state: 'DECLINED', pickupFallback: true });
      const toSeeker = events.filter((e) => 'userId' in e.to && e.to.userId === seeker.userId);
      expect(toSeeker.map((e) => e.type)).toEqual(
        expect.arrayContaining(['order.updated', 'errand.updated']),
      );
    });

    it('an expiry turns it back to pickup too; an acceptance keeps delivery', async () => {
      const id = (await errandOrder()).body.id as string;
      await pool.query(
        `UPDATE delivery_orders SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [id],
      );
      await sweepOrders({ db: pool, logger: quiet });
      expect((await errandView()).plan.modes).toEqual({});

      const next = (await errandOrder()).body.id as string;
      await act(shop, next, 'accept');
      expect((await errandView()).plan.modes).toEqual({ [shop.shopId]: 'delivery' });
    });

    it('after a delivery choice the recommendation uses the configured ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE, not the default', async () => {
      // Delivery from B leaves sasta with 2 stops and kam_dukaan with 1, for ₹20 more. The app's
      // configured limit is ₹10 (and 10 % of ₹100 is ₹10), so kam_dukaan is not worth it. The
      // default limit (₹30) would have recommended it.
      const res = await request(app)
        .post(`/errands/${errandId}/modes`)
        .set(auth(seeker))
        .send({ shopId: shop.shopId, mode: 'delivery' });
      expect(res.status).toBe(200);
      expect(res.body.plan.recommended).toBe('sasta');
      expect(res.body.plan.recommendation).toMatchObject({ stopsSaved: 1, extraPaise: 2000 });
      const again = await errandView();
      expect(again.plan.recommended).toBe('sasta');
    });
  });

  describe('privacy: the address lives only on the order', () => {
    it('is in no other table, no log line, no event, and no shop list', async () => {
      const requestId = await answeredRequest();
      const id = (await place(requestId, { customerName: 'Asha Verma' })).body.id as string;
      await act(shop, id, 'accept');
      await act(shop, id, 'out');
      await act(seeker, id, 'received');
      await request(app).get('/shops/me/orders').set(auth(shop));
      await request(app).get('/shops/me').set(auth(shop));
      await request(app).get('/shops/me/pings').set(auth(shop));
      await request(app).get(`/requests/${requestId}`).set(auth(seeker));

      const needles = ['Sapna', 'Vijay Nagar', 'Flat 4B', 'Verma'];
      const tables = (
        await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name <> 'delivery_orders' AND table_type = 'BASE TABLE'
              AND table_name NOT LIKE 'pgmigrations'`,
        )
      ).rows.map((r) => r.table_name);
      for (const table of tables) {
        const dump = await pool.query<{ t: string }>(`SELECT t::text AS t FROM "${table}" t`);
        for (const needle of needles)
          expect(
            dump.rows.some((r) => r.t.includes(needle)),
            `${needle} found in ${table}`,
          ).toBe(false);
      }
      const logged = logs.join('\n');
      for (const needle of needles) expect(logged).not.toContain(needle);
      expect(logged).not.toContain(String(ORIGIN.lat)); // nor the pin
      const sent = JSON.stringify(events);
      for (const needle of needles) expect(sent).not.toContain(needle);
      expect(sent).not.toContain(String(ORIGIN.lat));
    });

    it('is not in the seeker’s request view or the shop’s own record', async () => {
      const requestId = await answeredRequest();
      const id = (await place(requestId)).body.id as string;
      await act(shop, id, 'accept');
      for (const res of [
        await request(app).get(`/requests/${requestId}`).set(auth(seeker)),
        await request(app).get(`/requests/${requestId}/results`).set(auth(seeker)),
        await request(app).get('/shops/me').set(auth(shop)),
        await request(app).get('/shops/me/pings').set(auth(shop)),
      ])
        expect(JSON.stringify(res.body)).not.toContain('Sapna');
    });

    it('a model never sees it: the agent’s prompt and tool code do not read orders', async () => {
      const { readdirSync, readFileSync } = await import('node:fs');
      const dir = new URL('./modules/errands/', import.meta.url);
      for (const file of readdirSync(dir).filter(
        (f) => f.endsWith('.ts') && !f.includes('.test.'),
      )) {
        const text = readFileSync(new URL(file, dir), 'utf8');
        expect(text, file).not.toMatch(/delivery_orders|address_text|addressText/);
      }
    });
  });

  describe('live hints carry ids and a state, nothing else', () => {
    it('tells the shop about a new order and both sides about every move', async () => {
      const placed = await place(await answeredRequest());
      const id = placed.body.id as string;
      const created = events.filter((e) => e.type === 'order.created');
      expect(created).toHaveLength(1);
      expect(created[0]?.to).toEqual({ userId: shop.userId });
      expect(created[0]?.data).toEqual({ orderId: id });
      events.length = 0;
      await act(shop, id, 'accept');
      const updated = events.filter((e) => e.type === 'order.updated');
      expect(updated.map((e) => 'userId' in e.to && e.to.userId).sort()).toEqual(
        [seeker.userId, shop.userId].sort(),
      );
      expect(updated[0]?.data).toEqual({ orderId: id, state: 'ACCEPTED' });
    });

    it('a simulated shop’s new order also goes to the admin stream, for the simulator', async () => {
      await pool.query(`UPDATE shops SET is_simulated = true WHERE id = $1`, [shop.shopId]);
      const placed = await place(await answeredRequest());
      const forSim = events.find((e) => e.type === 'order.created' && 'admin' in e.to);
      expect(forSim?.data).toEqual({
        orderId: placed.body.id,
        shopId: shop.shopId,
        state: 'REQUESTED',
      });
    });
  });

  describe('a withdrawn ping says why', () => {
    it('ping.closed says "enough_answers" when another shop’s yes ended the request, and "answered" for the shop’s own answer', async () => {
      const made = await request(app)
        .post('/requests')
        .set(auth(seeker))
        .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng });
      const requestId = made.body.id as string;
      await fanOutPings(
        { db: pool, logger: quiet, config: { maxPings: 10 } },
        requestId,
        claimsAll,
      );
      const mine = (await request(app).get('/shops/me/pings').set(auth(shop))).body[0];
      const theirs = (await request(app).get('/shops/me/pings').set(auth(rival))).body[0];
      events.length = 0;
      await request(app)
        .post(`/pings/${theirs.id}/answer`)
        .set(auth(rival))
        .send({ answer: 'yes', pricePaise: 4000 });
      const closed = events.filter((e) => e.type === 'ping.closed');
      const forShop = closed.find((e) => 'userId' in e.to && e.to.userId === shop.userId);
      expect(forShop?.data).toEqual({ pingId: mine.id, reason: 'enough_answers' });
      const forRival = closed.find((e) => 'userId' in e.to && e.to.userId === rival.userId);
      expect(forRival?.data).toEqual({ pingId: theirs.id, reason: 'answered' });
    });
  });
});
