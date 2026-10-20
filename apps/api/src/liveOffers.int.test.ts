import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import {
  catchUpShop,
  createRequest,
  expireRequest,
  fanOutPings,
  MAX_LIVE_OFFERS,
  type PingClaims,
  type RequestsContext,
} from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const quiet = pino({ level: 'silent' });
const allow: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';
const DELIVERY = { delivery: { feePaise: 2000, minutes: 30 } };

// ADR-0043: the customer chooses. Up to MAX_LIVE_OFFERS shops may say yes; the other pings stay
// open until then, or until the request ends, or the customer orders or starts a pickup.
describe('collect up to three offers (S22 to S26)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let ctx: RequestsContext;
  let seeker: { token: string; userId: string };
  let phone = 9_897_000_000;
  const events: RealtimeEvent[] = [];
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  type Shop = { token: string; userId: string; shopId: string };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    realtime.onPublish((e) => events.push(e));
    app = createApp({ config: testConfig(), logger: quiet, db: pool, realtime });
    ctx = {
      db: pool,
      logger: quiet,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
    };
    seeker = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'requests, pings, shop_stock, delivery_orders, pickup_visits, errands',
    );
    await pool.query('DELETE FROM shops');
    events.length = 0;
  });

  async function shop(name: string, km: number): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories: ['grocery'] });
    return { ...owner, shopId: made.body.id as string };
  }
  const shops = (n: number) =>
    Promise.all(Array.from({ length: n }, (_, i) => shop(`Offer ${i} ${phone}`, 0.2 + i * 0.1)));
  const search = async () =>
    (await createRequest(ctx, seeker.userId, { q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng }))
      .request;
  const fan = (requestId: string) =>
    fanOutPings(
      { db: pool, logger: quiet, config: { maxPings: 10 }, events: realtime.events },
      requestId,
      allow,
    );
  const cards = async (s: Shop) => (await request(app).get('/shops/me/pings').set(auth(s))).body;
  const pingOf = async (s: Shop) =>
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM pings WHERE shop_id = $1 ORDER BY sent_at DESC LIMIT 1`,
        [s.shopId],
      )
    ).rows[0]?.id as string;
  const yes = async (s: Shop, pricePaise = 4500, extra: Record<string, unknown> = {}) =>
    request(app)
      .post(`/pings/${await pingOf(s)}/answer`)
      .set(auth(s))
      .send({ answer: 'yes', pricePaise, ...extra });
  const states = async (requestId: string) =>
    Object.fromEntries(
      (
        await pool.query<{ shop_id: string; state: string; late: boolean }>(
          `SELECT shop_id, state, late FROM pings WHERE request_id = $1`,
          [requestId],
        )
      ).rows.map((r) => [r.shop_id, `${r.state}${r.late ? '/late' : ''}`]),
    );
  const status = async (id: string) =>
    (await request(app).get(`/requests/${id}`).set(auth(seeker))).body;
  const stock = async (s: Shop) =>
    (await pool.query(`SELECT 1 FROM shop_stock WHERE shop_id = $1`, [s.shopId])).rowCount;
  const closedNotes = (reason: string) =>
    events.filter(
      (e) => e.type === 'ping.closed' && (e.data as { reason: string }).reason === reason,
    );

  it('the cap is three', () => {
    expect(MAX_LIVE_OFFERS).toBe(3);
  });

  it('S22: the first yes answers the request but leaves the other pings open; the third withdraws the rest', async () => {
    const [a, b, c, d] = await shops(4);
    const r = await search();
    await fan(r.id);
    expect((await yes(a as Shop)).status).toBe(200);
    expect((await status(r.id)).state).toBe('ANSWERED');
    expect(await states(r.id)).toMatchObject({ [(b as Shop).shopId]: 'SENT' });
    expect(await cards(b as Shop)).toHaveLength(1); // still has the question
    expect(closedNotes('enough_answers')).toHaveLength(0);

    await yes(b as Shop);
    expect(await cards(d as Shop)).toHaveLength(1);
    events.length = 0;
    await yes(c as Shop);
    expect(await states(r.id)).toEqual({
      [(a as Shop).shopId]: 'YES',
      [(b as Shop).shopId]: 'YES',
      [(c as Shop).shopId]: 'YES',
      [(d as Shop).shopId]: 'NO_REPLY',
    });
    expect(await cards(d as Shop)).toHaveLength(0);
    expect(closedNotes('enough_answers').map((e) => e.to)).toEqual([
      { userId: (d as Shop).userId },
    ]);
    expect((await status(r.id)).results).toHaveLength(3);
  });

  it('S22: a fourth yes is late, remembered as stock, and not an offer', async () => {
    const [a, b, c, d] = await shops(4);
    const r = await search();
    await fan(r.id);
    for (const s of [a, b, c]) await yes(s as Shop);
    const late = await yes(d as Shop, 3900);
    expect(late.status).toBe(200);
    expect(late.body.late).toBe(true);
    expect(await stock(d as Shop)).toBe(1);
    const live = (await status(r.id)).results.filter(
      (x: { source: string }) => x.source === 'live',
    );
    expect(live).toHaveLength(3);
    expect(live.map((x: { shopId: string }) => x.shopId)).not.toContain((d as Shop).shopId);
  });

  it('S23: a third and a fourth yes at the same moment: exactly three are live, the other is late stock', async () => {
    const [a, b, c, d] = await shops(4);
    const r = await search();
    await fan(r.id);
    await yes(a as Shop);
    await yes(b as Shop);
    const both = await Promise.all([yes(c as Shop), yes(d as Shop)]);
    expect(both.map((x) => x.status)).toEqual([200, 200]);
    expect(both.filter((x) => x.body.late)).toHaveLength(1);
    const found = Object.values(await states(r.id));
    expect(found.filter((s) => s === 'YES')).toHaveLength(3);
    expect(found.filter((s) => s === 'YES/late')).toHaveLength(1);
    expect(await stock(c as Shop)).toBe(1);
    expect(await stock(d as Shop)).toBe(1);
    expect(
      (await status(r.id)).results.filter((x: { source: string }) => x.source === 'live'),
    ).toHaveLength(3);
  });

  it('S24: the customer orders after the first yes; the other open pings are withdrawn with the note', async () => {
    const [a, b, c] = await shops(3);
    const r = await search();
    await fan(r.id);
    await yes(a as Shop, 4500, DELIVERY);
    events.length = 0;
    const placed = await request(app)
      .post('/orders')
      .set(auth(seeker))
      .send({ shopId: (a as Shop).shopId, requestId: r.id, addressText: ADDRESS });
    expect(placed.status).toBe(201);
    expect(await states(r.id)).toMatchObject({
      [(b as Shop).shopId]: 'NO_REPLY',
      [(c as Shop).shopId]: 'NO_REPLY',
    });
    expect(await cards(b as Shop)).toHaveLength(0);
    expect(
      closedNotes('customer_chose')
        .map((e) => (e.to as { userId: string }).userId)
        .sort(),
    ).toEqual([(b as Shop).userId, (c as Shop).userId].sort());
  });

  it('S25: the request expires with two yes; both stay visible as live and the open ping is withdrawn', async () => {
    const [a, b, c] = await shops(3);
    const r = await search();
    await fan(r.id);
    await yes(a as Shop);
    await yes(b as Shop);
    events.length = 0;
    await pool.query(`UPDATE requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      r.id,
    ]);
    await expireRequest({ db: pool, logger: quiet, events: realtime.events }, r.id, 'sweeper');
    const after = await status(r.id);
    expect(after.state).toBe('CLOSED');
    expect(
      after.results
        .filter((x: { source: string }) => x.source === 'live')
        .map((x: { shopId: string }) => x.shopId)
        .sort(),
    ).toEqual([(a as Shop).shopId, (b as Shop).shopId].sort());
    expect((await states(r.id))[(c as Shop).shopId]).toBe('NO_REPLY');
    expect(closedNotes('request_ended')).toHaveLength(1);
  });

  it('S25: a yes after the deadline on an answered request is late', async () => {
    const [a, b] = await shops(2);
    const r = await search();
    await fan(r.id);
    await yes(a as Shop);
    await pool.query(`UPDATE requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      r.id,
    ]);
    const res = await yes(b as Shop);
    expect(res.body.late).toBe(true);
    expect(
      (await status(r.id)).results.filter((x: { source: string }) => x.source === 'live'),
    ).toHaveLength(1);
  });

  it('S26: catch-up reaches an answered request until three shops have said yes', async () => {
    const [a, b, c] = await shops(3);
    const r = await search();
    await fan(r.id);
    const late = await shop('Opens late', 0.9);
    const catchUp = () =>
      catchUpShop(
        { db: pool, logger: quiet, config: { maxPings: 10 }, events: realtime.events },
        late.shopId,
        allow,
      );
    await yes(a as Shop);
    await yes(b as Shop);
    // One yes more would be the third: with two it still has room.
    expect((await catchUp()).sent).toBe(1);
    await pool.query(`DELETE FROM pings WHERE shop_id = $1`, [late.shopId]);
    await yes(c as Shop);
    expect((await catchUp()).sent).toBe(0);
  });

  it('a pickup started from the request withdraws the other open pings', async () => {
    const [a, b] = await shops(2);
    const r = await search();
    await fan(r.id);
    await yes(a as Shop);
    events.length = 0;
    const res = await request(app)
      .post('/pickups')
      .set(auth(seeker))
      .send({
        shopId: (a as Shop).shopId,
        itemId: (
          await pool.query<{ item_id: string }>('SELECT item_id FROM requests WHERE id = $1', [
            r.id,
          ])
        ).rows[0]?.item_id,
        requestId: r.id,
      });
    expect(res.status).toBeLessThan(300);
    expect((await states(r.id))[(b as Shop).shopId]).toBe('NO_REPLY');
    expect(await cards(b as Shop)).toHaveLength(0);
    expect(closedNotes('customer_chose')).toHaveLength(1);
  });

  it('the customer closing an answered request withdraws the open pings', async () => {
    const [a, b] = await shops(2);
    const r = await search();
    await fan(r.id);
    await yes(a as Shop);
    await request(app).post(`/requests/${r.id}/close`).set(auth(seeker));
    expect((await states(r.id))[(b as Shop).shopId]).toBe('NO_REPLY');
  });
});
