import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import {
  createAi,
  createFakeProvider,
  type AiContext,
  type FakeProvider,
} from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import {
  answerErrand,
  createErrand,
  getErrand,
  limitsFromConfig,
  runErrand,
  type ErrandLimits,
} from './modules/errands/index.js';
import { buildPlan } from './modules/errands/plan.js';
import { invalidateStockByCustomer } from './modules/shops/index.js';
import { sweepOrders } from './modules/orders/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import {
  createRequest,
  fanOutPings,
  type PingClaims,
  type RequestsContext,
} from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// docs/scenarios.md: interactions between features, each with the behaviour we expect. One test
// per scenario; the name starts with its number there. (S1 lives in shopCatchUp.int.test.ts.)
const quiet = pino({ level: 'silent' });
const allow: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';
const call = (name: string, args: Record<string, unknown>) => ({ name, args });

describe('cross-feature scenarios', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let ctx: RequestsContext;
  let provider: FakeProvider;
  let ai: AiContext;
  let seeker: { token: string; userId: string };
  let other: { token: string; userId: string };
  let phone = 9_891_000_000;
  const events: RealtimeEvent[] = [];
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const config = testConfig({ errandFewerStopsMaxExtraPaise: 1000 });
  const limits: ErrandLimits = { ...limitsFromConfig(config), userHourlyLimit: 10_000 };
  const ids: Record<string, string> = {};
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  type Shop = { token: string; userId: string; shopId: string };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    for (const r of (await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items'))
      .rows)
      ids[r.slug] = r.id;
    realtime.onPublish((e) => events.push(e));
    provider = createFakeProvider();
    ai = createAi({
      provider,
      db: pool,
      logger: quiet,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
    app = createApp({ config, logger: quiet, db: pool, realtime, ai });
    ctx = {
      db: pool,
      logger: quiet,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
      ai,
    };
    seeker = await loginAs(app, 'seeker', String(phone++));
    other = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE requests, pings, shop_stock, delivery_orders, errands, ai_calls, new_item_attempts CASCADE',
    );
    await pool.query('DELETE FROM shops');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    await pool.query('TRUNCATE query_cache');
    events.length = 0;
    provider.calls.length = 0;
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category: 'stationery' }
        : { itemId: null, needsClarification: false },
    );
  });

  async function shop(
    name: string,
    km: number,
    categories: string[] = ['grocery'],
    delivery?: { feePaise?: number; minutes?: number },
  ): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories, ...(delivery && { delivery }) });
    return { ...owner, shopId: made.body.id as string };
  }
  const search = async (q: string, who = seeker) => {
    const { request: r } = await createRequest(ctx, who.userId, {
      q,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
    });
    return r;
  };
  const fan = (requestId: string, maxPings = 10) =>
    fanOutPings(
      { db: pool, logger: quiet, config: { maxPings }, events: realtime.events },
      requestId,
      allow,
    );
  const cards = async (s: Shop) => (await request(app).get('/shops/me/pings').set(auth(s))).body;
  const answer = (s: Shop, pingId: string, body: Record<string, unknown>) =>
    request(app).post(`/pings/${pingId}/answer`).set(auth(s)).send(body);
  /** The shop says yes to its (only) ping, found by the shop: a card that left the list still answers. */
  const yes = async (s: Shop, extra: Record<string, unknown> = {}) => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM pings WHERE shop_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [s.shopId],
    );
    return answer(s, (rows[0] as { id: string }).id, { answer: 'yes', pricePaise: 4500, ...extra });
  };
  const status = async (id: string, who = seeker) =>
    (await request(app).get(`/requests/${id}`).set(auth(who))).body;
  const setOpen = (s: Shop, open: boolean) =>
    request(app).put('/shops/me/open').set(auth(s)).send({ open });
  const stockOf = async (shopId: string, slug: string) =>
    (
      await pool.query(`SELECT * FROM shop_stock WHERE shop_id = $1 AND item_id = $2`, [
        shopId,
        ids[slug],
      ])
    ).rows[0];

  it('S2: a shop that closes keeps its open card: it can still answer, and its answer is remembered but hidden while it is closed', async () => {
    const s = await shop('S2 Kirana', 0.3);
    const r = await search('chini');
    await fan(r.id);
    expect(await cards(s)).toHaveLength(1);
    await setOpen(s, false);
    expect(await cards(s)).toHaveLength(1); // the question is not taken away
    expect((await yes(s)).status).toBe(200);
    expect(await stockOf(s.shopId, 'sugar')).toBeTruthy();
    // Closed: nobody is sent to it from learned stock.
    const next = await search('chini', other);
    expect(next.results).toEqual([]);
    await setOpen(s, true);
    expect((await status((await search('chini', other)).id, other)).results).toHaveLength(1);
  });

  it('S3: a shop that closes still answers an order already placed; nobody can place a new one', async () => {
    const s = await shop('S3 Kirana', 0.3, ['grocery'], { feePaise: 3000, minutes: 45 });
    const r = await search('chini');
    await fan(r.id);
    await yes(s, { delivery: { feePaise: 3000, minutes: 45 } });
    const placed = await request(app)
      .post('/orders')
      .set(auth(seeker))
      .send({ shopId: s.shopId, requestId: r.id, addressText: ADDRESS });
    expect(placed.status).toBe(201);
    await setOpen(s, false);
    const accepted = await request(app).post(`/orders/${placed.body.id}/accept`).set(auth(s));
    expect(accepted.status).toBe(200);
    expect(accepted.body.state).toBe('ACCEPTED');
    const another = await request(app)
      .post('/orders')
      .set(auth(other))
      .send({ shopId: s.shopId, requestId: r.id, addressText: ADDRESS });
    expect([404, 409]).toContain(another.status);
    const mine = await request(app)
      .post('/orders')
      .set(auth(seeker))
      .send({ shopId: s.shopId, requestId: r.id, addressText: ADDRESS });
    expect(mine.status).toBe(409); // closed: told so, whoever asks
  });

  it('S4: a late answer after the request expired teaches the shop’s stock and does not revive the request', async () => {
    const s = await shop('S4 Kirana', 0.3);
    const r = await search('chini');
    await fan(r.id);
    await pool.query(`UPDATE requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      r.id,
    ]);
    const res = await yes(s);
    expect(res.status).toBe(200);
    expect(res.body.late).toBe(true);
    expect((await status(r.id)).state).toBe('EXPIRED');
    expect(await stockOf(s.shopId, 'sugar')).toBeTruthy();
    const next = await search('chini', other);
    expect(next.results).toHaveLength(1); // the next customer benefits
  });

  it('S5: two shops answering yes at the same moment are both kept; the request is answered once', async () => {
    const a = await shop('S5 A', 0.3);
    const b = await shop('S5 B', 0.5);
    const r = await search('chini');
    await fan(r.id);
    const [ca] = await cards(a);
    const [cb] = await cards(b);
    const both = await Promise.all([
      answer(a, ca.id, { answer: 'yes', pricePaise: 4000 }),
      answer(b, cb.id, { answer: 'yes', pricePaise: 4200 }),
    ]);
    expect(both.map((x) => x.status)).toEqual([200, 200]);
    expect((await status(r.id)).state).toBe('ANSWERED');
    expect(await stockOf(a.shopId, 'sugar')).toBeTruthy();
    expect(await stockOf(b.shopId, 'sugar')).toBeTruthy();
    expect((await status(r.id)).results.map((x: { shopId: string }) => x.shopId).sort()).toEqual(
      [a.shopId, b.shopId].sort(),
    );
  });

  it('S6: "Wahan nahi tha" hides the answer, the next search asks the shop again, and the plan follows the fresh answer', async () => {
    const s = await shop('S6 Kirana', 0.3);
    const r = await search('chini');
    await fan(r.id);
    await yes(s);
    await invalidateStockByCustomer(pool, s.shopId, ids['sugar'] as string, new Date());
    const where = { lat: ORIGIN.lat, lng: ORIGIN.lng };
    const claim = [{ text: 'chini', itemId: ids['sugar'], status: 'likely', shopId: s.shopId }];
    // Hidden: the plan does not offer the shop.
    const hidden = await buildPlan(pool, where, { items: claim } as never);
    expect(hidden.items[0]).toMatchObject({ status: 'not_found', shopId: null });
    // Asked again (through the dedupe window) and the fresh yes replaces the invalid answer.
    const again = await search('chini');
    const windowClaims = new Set<string>([`${s.shopId}-${ids['sugar']}`]);
    const claims: PingClaims = {
      claim: async (sh, it) => !windowClaims.has(`${sh}-${it}`),
      release: async (sh, it) => void windowClaims.delete(`${sh}-${it}`),
    };
    await fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, again.id, claims);
    expect(await cards(s)).toHaveLength(1);
    await yes(s, { pricePaise: 4700 });
    const fresh = await buildPlan(pool, where, { items: claim } as never);
    expect(fresh.items[0]).toMatchObject({ status: 'likely', shopId: s.shopId, pricePaise: 4700 });
    expect(fresh.items[0]?.customerVerified).not.toBe(true);
  });

  it('S7: one answer to a new item carries a photo, a quantity and a delivery offer: the item becomes verified and everything reaches the customer', async () => {
    const s = await shop('S7 Stationer', 0.3, ['stationery']);
    const r = await search('foam glitter sheet');
    expect(r.item?.unverified).toBe(true);
    await fan(r.id);
    const photo = (
      await request(app)
        .post('/photos')
        .query({ role: 'answer' })
        .set(auth(s))
        .set('Content-Type', 'image/jpeg')
        .send(
          await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2060c0' } })
            .jpeg()
            .toBuffer(),
        )
    ).body.id as string;
    const res = await yes(s, {
      photoId: photo,
      quantity: { amount: 10, unit: 'packet' },
      delivery: { feePaise: 2000, minutes: 30 },
    });
    expect(res.status).toBe(200);
    expect((await pool.query(`SELECT unverified FROM items WHERE source = 'user'`)).rows).toEqual([
      { unverified: false },
    ]);
    const seen = (await status(r.id)).results[0];
    expect(seen).toMatchObject({
      shopId: s.shopId,
      photoId: photo,
      quantity: { amount: 10, unit: 'packet' },
      delivery: { feePaise: 2000, minutes: 30 },
    });
    const learned = (await search('foam glitter sheet', other)).results[0];
    expect(learned).toMatchObject({
      source: 'learned',
      quantity: { amount: 10, unit: 'packet' },
      delivery: { feePaise: 2000, minutes: 30 },
    });
  });

  it('S8: an order whose shop did not answer in time expires; an accept racing the sweep leaves exactly one outcome', async () => {
    const s = await shop('S8 Kirana', 0.3, ['grocery'], { feePaise: 0, minutes: 30 });
    const outcomes = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await pool.query('TRUNCATE delivery_orders, requests, pings, shop_stock CASCADE');
      const r = await search('chini');
      await fan(r.id);
      await yes(s, { delivery: { minutes: 30 } });
      const placed = await request(app)
        .post('/orders')
        .set(auth(seeker))
        .send({ shopId: s.shopId, requestId: r.id, addressText: ADDRESS });
      await pool.query(`UPDATE delivery_orders SET expires_at = now() - interval '1 second'`);
      const [swept, accepted] = await Promise.all([
        sweepOrders({ db: pool, logger: quiet, events: realtime.events }),
        request(app).post(`/orders/${placed.body.id}/accept`).set(auth(s)),
      ]);
      const state = (await pool.query(`SELECT state FROM delivery_orders`)).rows[0]?.state;
      // Past its time the order is expired, whoever looked first; the accept never wins.
      expect(state).toBe('EXPIRED');
      expect([200, 409]).toContain(accepted.status);
      expect(swept).toBeLessThanOrEqual(1);
      outcomes.add(state);
    }
    expect([...outcomes]).toEqual(['EXPIRED']);
  });

  it('S10: with too few shops of the item’s kind the nearest of other kinds are asked, but a shop that opens later is only caught up for its own kinds', async () => {
    const near = await shop('S10 Kirana', 0.2, ['grocery']);
    const r = await search('ceiling fan'); // electrical: no such shop
    await fan(r.id);
    expect(await cards(near)).toHaveLength(1); // the fallback
    const stranger = await shop('S10 Dairy', 0.4, ['dairy']);
    const { catchUpShop } = await import('./modules/requests/index.js');
    const caught = await catchUpShop(
      { db: pool, logger: quiet, config: { maxPings: 10 } },
      stranger.shopId,
      allow,
    );
    expect(caught.sent).toBe(0);
  });

  describe('errand plans', () => {
    const where = { lat: ORIGIN.lat, lng: ORIGIN.lng };
    const stock = (shopId: string, slug: string, over: Record<string, unknown> = {}) =>
      pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, quantity_hint, qty_amount,
                                 qty_unit, last_confirmed_at, expires_at)
         VALUES ($1, $2, 'ping_yes', $3, $4, $5, $6, now(), now() + interval '7 days')`,
        [
          shopId,
          ids[slug],
          'price' in over ? over['price'] : 4000,
          over['hint'] ?? null,
          over['amount'] ?? null,
          over['unit'] ?? null,
        ],
      );
    const plan = (slug: string, shopId: string, quantity = 1) =>
      buildPlan(pool, where, {
        items: [{ text: slug, itemId: ids[slug], status: 'likely', shopId, quantity }],
      } as never);

    it('S12: a shop that did not say a price is in the plan with no price, counted, never ₹0', async () => {
      const s = await shop('S12 Kirana', 0.3);
      await stock(s.shopId, 'sugar', { price: null });
      const p = await plan('sugar', s.shopId);
      expect(p.items[0]).toMatchObject({ status: 'likely', pricePaise: null });
      expect(p.totalPricePaise).toBe(0);
      expect(p.plans.sasta.unknownPriceCount).toBe(1);
    });

    it('S13: "Kam hai": a shop that has fewer than wanted is flagged short, and a "thoda hai" answer shows on the card', async () => {
      const s = await shop('S13 Kirana', 0.3);
      await stock(s.shopId, 'sugar', { amount: 3, unit: 'packet', hint: 'few' });
      const p = await plan('sugar', s.shopId, 5);
      expect(p.items[0]).toMatchObject({
        quantityCheck: 'short',
        offeredQuantity: { amount: 3, unit: 'packet' },
        quantityHint: 'few',
      });
      const enough = await plan('sugar', s.shopId, 2);
      expect(enough.items[0]?.quantityCheck).toBe('enough');
    });

    it('S14: a closed shop’s learned stock leaves the plan and comes back when it opens', async () => {
      const s = await shop('S14 Kirana', 0.3);
      await stock(s.shopId, 'sugar');
      await setOpen(s, false);
      expect((await plan('sugar', s.shopId)).items[0]).toMatchObject({ status: 'not_found' });
      await setOpen(s, true);
      expect((await plan('sugar', s.shopId)).items[0]).toMatchObject({ status: 'likely' });
    });

    it('S11: "mirchi" in a checklist: the customer is asked which one, and the plan carries their choice', async () => {
      const s = await shop('S11 Kirana', 0.3);
      await stock(s.shopId, 'green-chilli');
      const { id } = await createErrand({ db: pool, logger: quiet, limits }, seeker.userId, {
        task: 'sabzi ka saaman',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        requestId: 'req-s11',
      });
      provider.playChat([
        {
          toolCalls: [
            call('ask_user', {
              question: 'Ye cheezein chahiye?',
              options: ['mirchi', 'chini'],
              multiSelect: true,
              preselected: [0, 1],
            }),
          ],
        },
        {
          toolCalls: [
            call('resolve_item', { text: 'mirchi' }),
            call('resolve_item', { text: 'chini' }),
          ],
        },
        {
          toolCalls: [
            call('ask_user', {
              question: 'Kaunsi mirch chahiye?',
              options: ['red chilli powder', 'green chilli', 'black pepper'],
            }),
          ],
        },
        { toolCalls: [call('resolve_item', { text: 'green chilli' })] },
        {
          toolCalls: [
            call('submit_plan', {
              items: [
                { text: 'mirchi', itemId: ids['green-chilli'], status: 'likely', shopId: s.shopId },
                { text: 'chini', itemId: ids['sugar'], status: 'not_found' },
              ],
            }),
          ],
        },
      ]);
      const deps = { db: pool, logger: quiet, ai, limits, trigramThreshold: 0.4 };
      await runErrand(deps, id);
      const checklist = { db: pool, logger: quiet, limits };
      await answerErrand(checklist, seeker.userId, id, { selected: [0, 1] });
      await runErrand(deps, id);
      // The word did not resolve to a guess: the model was handed a clarification with the options.
      const resolved = (
        await pool.query<{ result: { clarification?: { options: { itemId: string }[] } } }>(
          `SELECT payload->'result' AS result FROM errand_steps
            WHERE errand_id = $1 AND tool_name = 'resolve_item' ORDER BY n`,
          [id],
        )
      ).rows;
      expect(resolved[0]?.result.clarification?.options.map((o) => o.itemId).sort()).toEqual(
        [ids['red-chilli-powder'], ids['green-chilli'], ids['black-pepper']].sort(),
      );
      await answerErrand(checklist, seeker.userId, id, { optionIndex: 1 });
      await runErrand(deps, id);
      const view = await getErrand({ db: pool, logger: quiet }, seeker.userId, id);
      expect(view?.state).toBe('PLAN_READY');
      const items = (view?.plan as unknown as { items: { itemName: string; status: string }[] })
        .items;
      expect(items[0]).toMatchObject({ itemName: 'green chilli', status: 'likely' });
    });
  });

  it('S15: a customer who closes the search does not stop a shop’s later answer from teaching stock', async () => {
    const s = await shop('S15 Kirana', 0.3);
    const r = await search('chini');
    await fan(r.id);
    await request(app).post(`/requests/${r.id}/close`).set(auth(seeker));
    expect((await status(r.id)).state).toBe('CLOSED');
    const res = await yes(s);
    expect(res.status).toBe(200);
    expect(res.body.late).toBe(true);
    expect((await status(r.id)).state).toBe('CLOSED');
    expect(await stockOf(s.shopId, 'sugar')).toBeTruthy();
  });
});
