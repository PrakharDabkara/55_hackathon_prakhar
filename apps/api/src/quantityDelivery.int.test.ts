import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });
const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };

// ADR-0031: exact quantity and a delivery offer on a yes, an open/closed switch, per-shop modes.
describe('exact quantity, delivery offer, open switch', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_895_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let shop: User & { shopId: string };
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({ config: testConfig(), logger, db: pool });
    seeker = await loginAs(app, 'seeker', String(phone++));
    const u = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(u))
      .send({ name: 'Q Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    shop = { ...u, shopId: made.body.id };
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE requests, pings, shop_stock CASCADE');
    await pool.query(`UPDATE shops SET closed_until = NULL`);
  });

  const ask = (q = 'chini') =>
    request(app).post('/requests').set(auth(seeker)).send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
  const pingFor = async (requestId: string) => {
    await fanOutPings({ db: pool, logger, config: { maxPings: 10 } }, requestId, claimsAll);
    return (await request(app).get('/shops/me/pings').set(auth(shop))).body[0];
  };
  const answer = (pingId: string, body: Record<string, unknown>) =>
    request(app).post(`/pings/${pingId}/answer`).set(auth(shop)).send(body);

  describe('the answer', () => {
    it('keeps an exact quantity and a delivery offer next to the price', async () => {
      const made = await ask();
      const ping = await pingFor(made.body.id);
      const res = await answer(ping.id, {
        answer: 'yes',
        pricePaise: 5000,
        quantity: { amount: 5, unit: 'kg' },
        delivery: { feePaise: 3000, minutes: 45 },
      });
      expect(res.status).toBe(200);
      const { rows } = await pool.query(
        `SELECT qty_amount::float8 AS amount, qty_unit, delivers, delivery_fee_paise, delivery_minutes
           FROM pings WHERE id = $1`,
        [ping.id],
      );
      expect(rows[0]).toEqual({
        amount: 5,
        qty_unit: 'kg',
        delivers: true,
        delivery_fee_paise: 3000,
        delivery_minutes: 45,
      });
    });

    it('a delivery with no fee and no time is still an offer', async () => {
      const ping = await pingFor((await ask()).body.id);
      await answer(ping.id, { answer: 'yes', delivery: {} });
      const { rows } = await pool.query(
        `SELECT delivers, delivery_fee_paise, delivery_minutes FROM pings WHERE id = $1`,
        [ping.id],
      );
      expect(rows[0]).toEqual({ delivers: true, delivery_fee_paise: null, delivery_minutes: null });
    });

    it('a fee of 0 is kept as 0 (free), not as "not told"', async () => {
      const ping = await pingFor((await ask()).body.id);
      await answer(ping.id, { answer: 'yes', delivery: { feePaise: 0 } });
      const { rows } = await pool.query(`SELECT delivery_fee_paise FROM pings WHERE id = $1`, [
        ping.id,
      ]);
      expect(rows[0].delivery_fee_paise).toBe(0);
    });

    it('refuses what makes no sense: an unknown unit, a zero or negative amount, a fee below 0, a quantity with a no', async () => {
      const ping = await pingFor((await ask()).body.id);
      for (const body of [
        { answer: 'yes', quantity: { amount: 5, unit: 'dozen' } },
        { answer: 'yes', quantity: { amount: 0, unit: 'kg' } },
        { answer: 'yes', quantity: { amount: -2, unit: 'kg' } },
        { answer: 'yes', quantity: { amount: 5 } },
        { answer: 'yes', quantity: { amount: 99999999, unit: 'kg' } },
        { answer: 'yes', delivery: { feePaise: -1 } },
        { answer: 'yes', delivery: { minutes: 0 } },
        { answer: 'no', quantity: { amount: 5, unit: 'kg' } },
        { answer: 'no', delivery: {} },
      ]) {
        const res = await answer(ping.id, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect(
        (await pool.query(`SELECT state FROM pings WHERE id = $1`, [ping.id])).rows[0].state,
      ).toBe('SENT');
    });

    it('works with neither: the old one-tap yes is unchanged', async () => {
      const ping = await pingFor((await ask()).body.id);
      expect((await answer(ping.id, { answer: 'yes' })).status).toBe(200);
      const { rows } = await pool.query(
        `SELECT qty_amount, qty_unit, delivers FROM pings WHERE id = $1`,
        [ping.id],
      );
      expect(rows[0]).toEqual({ qty_amount: null, qty_unit: null, delivers: false });
    });
  });

  describe('what the customer sees', () => {
    it('a live answer shows the quantity and the delivery offer; a request for 2 kg is checked against 1 kg', async () => {
      const made = await ask('chini 2 kg');
      const ping = await pingFor(made.body.id);
      await answer(ping.id, {
        answer: 'yes',
        pricePaise: 5000,
        quantity: { amount: 1, unit: 'kg' },
        delivery: { feePaise: 2500, minutes: 30 },
      });
      const view = await request(app).get(`/requests/${made.body.id}`).set(auth(seeker));
      expect(view.body.results[0]).toMatchObject({
        source: 'live',
        quantity: { amount: 1, unit: 'kg' },
        quantityCheck: 'short',
        delivery: { feePaise: 2500, minutes: 30 },
      });
    });

    it('is enough when the shop has more than asked, unknown for a unit that cannot be compared, and absent without a quantity', async () => {
      const cases: [string, Record<string, unknown> | undefined, string | undefined][] = [
        ['chini 2 kg', { amount: 5, unit: 'kg' }, 'enough'],
        ['chini 2 kg', { amount: 1, unit: 'packet' }, 'unknown'],
        ['chini 2 kg', undefined, undefined],
        ['chini', { amount: 5, unit: 'kg' }, undefined],
      ];
      for (const [q, quantity, check] of cases) {
        await pool.query('TRUNCATE requests, pings, shop_stock CASCADE');
        const made = await ask(q);
        const ping = await pingFor(made.body.id);
        await answer(ping.id, { answer: 'yes', ...(quantity && { quantity }) });
        const view = await request(app).get(`/requests/${made.body.id}`).set(auth(seeker));
        expect(view.body.results[0].quantityCheck, `${q} ${JSON.stringify(quantity)}`).toBe(check);
      }
    });

    it('learned stock keeps the quantity and the delivery offer, and fades in 3 days (7 without an exact quantity)', async () => {
      const first = await ask();
      const ping = await pingFor(first.body.id);
      await answer(ping.id, {
        answer: 'yes',
        quantity: { amount: 5, unit: 'kg' },
        delivery: { feePaise: 3000 },
      });
      const stock = await pool.query(
        `SELECT qty_amount::float8 AS amount, qty_unit, delivers, delivery_fee_paise,
                expires_at - last_confirmed_at AS ttl FROM shop_stock WHERE shop_id = $1`,
        [shop.shopId],
      );
      expect(stock.rows[0]).toMatchObject({
        amount: 5,
        qty_unit: 'kg',
        delivers: true,
        delivery_fee_paise: 3000,
      });
      expect(stock.rows[0].ttl).toEqual({ days: 3 });

      // The next person sees it as learned stock: remembered, never subtracted.
      await pool.query(`UPDATE requests SET state = 'CLOSED'`);
      const next = await ask();
      expect(next.body.results[0]).toMatchObject({
        source: 'learned',
        quantity: { amount: 5, unit: 'kg' },
        delivery: { feePaise: 3000, minutes: null },
      });
      const again = await ask();
      expect(again.body.results[0].quantity).toEqual({ amount: 5, unit: 'kg' }); // not used up
    });
  });

  describe('the open / closed switch ("Dukaan aaj band hai")', () => {
    const setOpen = (open: boolean) =>
      request(app).put('/shops/me/open').set(auth(shop)).send({ open });

    it('closing marks the shop closed until the end of today and reports it; opening clears it', async () => {
      const closed = await setOpen(false);
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({ open: false });
      const until = new Date(closed.body.closedUntil).getTime();
      expect(until).toBeGreaterThan(Date.now());
      expect(until).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);
      expect((await request(app).get('/shops/me').set(auth(shop))).body.open).toBe(false);
      const opened = await setOpen(true);
      expect(opened.body).toMatchObject({ open: true });
      expect(opened.body.closedUntil).toBeNull();
    });

    it('opens by itself when the day is over', async () => {
      await setOpen(false);
      await pool.query(`UPDATE shops SET closed_until = now() - interval '1 minute'`);
      expect((await request(app).get('/shops/me').set(auth(shop))).body.open).toBe(true);
    });

    it('a closed shop gets no pings', async () => {
      await setOpen(false);
      const made = await ask();
      await fanOutPings({ db: pool, logger, config: { maxPings: 10 } }, made.body.id, claimsAll);
      expect(
        (await pool.query(`SELECT 1 FROM pings WHERE request_id = $1`, [made.body.id])).rowCount,
      ).toBe(0);
      await setOpen(true);
      const again = await ask('namak');
      await fanOutPings({ db: pool, logger, config: { maxPings: 10 } }, again.body.id, claimsAll);
      expect(
        (await pool.query(`SELECT 1 FROM pings WHERE request_id = $1`, [again.body.id])).rowCount,
      ).toBe(1);
    });

    it('a closed shop is left out of learned stock while closed, and back when it opens', async () => {
      const first = await ask();
      const ping = await pingFor(first.body.id);
      await answer(ping.id, { answer: 'yes', pricePaise: 5000 });
      await pool.query(`UPDATE requests SET state = 'CLOSED'`);
      await setOpen(false);
      const hidden = await ask();
      expect(hidden.body.results).toEqual([]);
      await setOpen(true);
      const shown = await ask();
      expect(shown.body.results.map((r: { shopId: string }) => r.shopId)).toEqual([shop.shopId]);
    });

    it('is for the shop owner only', async () => {
      expect(
        (await request(app).put('/shops/me/open').set(auth(seeker)).send({ open: false })).status,
      ).toBe(403);
      expect(
        (await request(app).put('/shops/me/open').set(auth(shop)).send({ open: 'no' })).status,
      ).toBe(400);
    });
  });

  describe('standing delivery defaults', () => {
    it('are given at onboarding, changed with PATCH, and read back', async () => {
      const u = await loginAs(app, 'shop', String(phone++));
      const made = await request(app)
        .post('/shops')
        .set(auth(u))
        .send({
          name: 'Defaults',
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
          categories: ['grocery'],
          delivery: { feePaise: 2000, minutes: 40 },
        });
      expect(made.status).toBe(201);
      expect(made.body).toMatchObject({
        deliversDefault: true,
        defaultFeePaise: 2000,
        defaultMinutes: 40,
        open: true,
      });
      const patched = await request(app).patch('/shops/me').set(auth(u)).send({ delivery: null });
      expect(patched.body).toMatchObject({
        deliversDefault: false,
        defaultFeePaise: null,
        defaultMinutes: null,
      });
      const plain = await request(app)
        .post('/shops')
        .set(auth(await loginAs(app, 'shop', String(phone++))))
        .send({ name: 'Plain', lat: ORIGIN.lat, lng: ORIGIN.lng, categories: ['grocery'] });
      expect(plain.body).toMatchObject({ deliversDefault: false, defaultFeePaise: null });
    });

    it('refuses a negative fee or a zero time', async () => {
      const u = await loginAs(app, 'shop', String(phone++));
      const res = await request(app)
        .post('/shops')
        .set(auth(u))
        .send({
          name: 'Bad',
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
          categories: ['grocery'],
          delivery: { feePaise: -5 },
        });
      expect(res.status).toBe(400);
    });
  });

  describe('pickup or delivery for each shop on a finished plan', () => {
    const stop = (shopId: string, label: string, km: number) => ({
      shopId,
      label,
      lat: north(km),
      lng: ORIGIN.lng,
    });
    const row = (shopId: string, shopName: string, delivery: unknown) => ({
      text: shopName,
      itemId: `item-${shopId}`,
      itemName: shopName,
      quantity: 1,
      status: 'confirmed',
      shopId,
      shopName,
      distanceM: 500,
      pricePaise: 5000,
      referencePricePaise: null,
      freshness: 'Confirmed just now',
      downgraded: null,
      matchedAs: false,
      delivery,
      offeredQuantity: null,
      photoId: null,
    });
    const variant = () => ({
      kind: 'sasta',
      items: [
        row('00000000-0000-4000-8000-00000000000a', 'A', null),
        row('00000000-0000-4000-8000-00000000000b', 'B', { feePaise: 3000, minutes: 45 }),
      ],
      route: {
        orderedStops: [
          stop('00000000-0000-4000-8000-00000000000a', 'A', 0.4),
          stop('00000000-0000-4000-8000-00000000000b', 'B', 1),
        ],
        legsM: [400, 600],
        totalM: 1000,
      },
      totalPricePaise: 10000,
      comparablePricePaise: 10000,
      unknownPriceCount: 0,
      totalDistanceM: 1000,
      shopCount: 2,
      savingsPaise: 0,
    });
    const B = '00000000-0000-4000-8000-00000000000b';
    const A = '00000000-0000-4000-8000-00000000000a';
    let errandId: string;
    beforeEach(async () => {
      await pool.query('TRUNCATE errands CASCADE');
      const plan = {
        items: variant().items,
        route: variant().route,
        totalPricePaise: 10000,
        savingsPaise: 0,
        plans: { sasta: variant(), kam_dukaan: { ...variant(), kind: 'kam_dukaan' } },
        recommended: 'sasta',
        recommendation: { extraPaise: 0, stopsSaved: 0, reason: 'no_stops_saved' },
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
    const mode = (user: User, shopId: string, m: string) =>
      request(app).post(`/errands/${errandId}/modes`).set(auth(user)).send({ shopId, mode: m });

    it('starts as pickup everywhere, with the grand total equal to the items', async () => {
      const view = await request(app).get(`/errands/${errandId}`).set(auth(seeker));
      const sasta = view.body.plan.plans.sasta;
      expect(sasta).toMatchObject({ deliveryFeePaise: 0, grandTotalPaise: 10000, shopCount: 2 });
      expect(sasta.items.map((i: { mode: string }) => i.mode)).toEqual(['pickup', 'pickup']);
      expect(view.body.plan.modes).toEqual({});
    });

    it('switching a shop to delivery adds its fee once, takes it off the route and keeps the choice', async () => {
      const res = await mode(seeker, B, 'delivery');
      expect(res.status).toBe(200);
      for (const kind of ['sasta', 'kam_dukaan']) {
        const v = res.body.plan.plans[kind];
        expect(v).toMatchObject({
          deliveryFeePaise: 3000,
          grandTotalPaise: 13000,
          shopCount: 1,
          deliveryShopCount: 1,
        });
        expect(v.route.orderedStops.map((s: { shopId: string }) => s.shopId)).toEqual([A]);
      }
      expect(res.body.plan.modes).toEqual({ [B]: 'delivery' });
      const again = await request(app).get(`/errands/${errandId}`).set(auth(seeker));
      expect(again.body.plan.modes).toEqual({ [B]: 'delivery' });
      const back = await mode(seeker, B, 'pickup');
      expect(back.body.plan.plans.sasta).toMatchObject({ deliveryFeePaise: 0, shopCount: 2 });
    });

    it("is the owner's alone, for a shop in the plan, and a valid mode", async () => {
      const other = await loginAs(app, 'seeker', String(phone++));
      expect((await mode(other, B, 'delivery')).status).toBe(404);
      expect((await mode(seeker, '00000000-0000-4000-8000-0000000000ff', 'delivery')).status).toBe(
        400,
      );
      expect((await mode(seeker, B, 'teleport')).status).toBe(400);
      expect((await mode(seeker, A, 'delivery')).status).toBe(400); // A does not deliver
    });

    it('is refused while there is no plan', async () => {
      await pool.query(`UPDATE errands SET state = 'PLANNING', plan = NULL WHERE id = $1`, [
        errandId,
      ]);
      expect((await mode(seeker, B, 'delivery')).status).toBe(409);
    });
  });
});
