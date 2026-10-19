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
  fanOutPings,
  type PingClaims,
  type RequestHooks,
  type RequestsContext,
} from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const quiet = pino({ level: 'silent' });
const allow: PingClaims = { claim: async () => true, release: async () => undefined };

// Day 17, PR I.2 (ADR-0038): a shop that opens, or finishes onboarding, is sent the live requests
// nearby that it was never asked.
describe('catch-up pings for a shop that opens late', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let ctx: RequestsContext;
  let seeker: { token: string; userId: string };
  let phone = 9_896_000_000;
  const events: RealtimeEvent[] = [];
  const wanted: string[] = [];
  const hooks: RequestHooks = { enqueueShopCatchUp: async (shopId) => void wanted.push(shopId) };
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    realtime.onPublish((e) => events.push(e));
    app = createApp({
      config: testConfig(),
      logger: quiet,
      db: pool,
      realtime,
      requestHooks: hooks,
    });
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
    await pool.query('TRUNCATE requests, pings, shop_stock CASCADE');
    await pool.query('DELETE FROM shops');
    events.length = 0;
    wanted.length = 0;
  });

  async function makeShop(
    categories: string[] = ['grocery'],
    km = 0.3,
    open = true,
  ): Promise<{ token: string; userId: string; shopId: string }> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name: `Late ${phone}`, lat: north(km), lng: ORIGIN.lng, categories });
    if (!open) await request(app).put('/shops/me/open').set(auth(owner)).send({ open: false });
    return { ...owner, shopId: made.body.id as string };
  }
  const pinging = async (q = 'chini') => {
    const { request: r } = await createRequest(ctx, seeker.userId, {
      q,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
    });
    expect(r.state).toBe('PINGING');
    return r.id;
  };
  const fan = (id: string) =>
    fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, id, allow);
  const catchUp = (shopId: string, claims: PingClaims = allow, maxPings = 10) =>
    catchUpShop(
      { db: pool, logger: quiet, config: { maxPings }, events: realtime.events },
      shopId,
      claims,
    );
  const reopen = (shop: { token: string }) =>
    request(app).put('/shops/me/open').set(auth(shop)).send({ open: true });
  const pingCount = async (requestId: string, shopId?: string) =>
    (
      await pool.query(
        `SELECT 1 FROM pings WHERE request_id = $1 AND ($2::uuid IS NULL OR shop_id = $2)`,
        [requestId, shopId ?? null],
      )
    ).rowCount;

  it('a shop closed at request time is asked once it opens, and its owner is told', async () => {
    const shop = await makeShop(['grocery'], 0.3, false);
    const id = await pinging();
    await fan(id);
    expect(await pingCount(id)).toBe(0); // closed: nobody was asked

    expect((await reopen(shop)).status).toBe(200);
    expect(wanted).toEqual([shop.shopId]); // the open tap queues the catch-up
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 1 });
    expect(await pingCount(id, shop.shopId)).toBe(1);
    const mine = (await request(app).get('/shops/me/pings').set(auth(shop))).body;
    expect(mine).toHaveLength(1);
    expect(events.some((e) => e.type === 'ping.created' && 'userId' in e.to)).toBe(true);
  });

  it('a shop that finishes onboarding while a request is live is asked too', async () => {
    const id = await pinging();
    const shop = await makeShop();
    expect(wanted).toEqual([shop.shopId]);
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 1 });
    expect(await pingCount(id, shop.shopId)).toBe(1);
  });

  it('never asks a shop twice about the same request', async () => {
    const shop = await makeShop();
    const id = await pinging();
    await fan(id);
    expect(await pingCount(id, shop.shopId)).toBe(1);
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 0 });
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 0 });
    expect(await pingCount(id, shop.shopId)).toBe(1);
  });

  it('skips a request that ends within 2 minutes, and asks about one that ends in 3', async () => {
    const shop = await makeShop(['grocery'], 0.3, false);
    const ending = await pinging('chini');
    const lasting = await pinging('namak');
    await pool.query(
      `UPDATE requests SET expires_at = now() + interval '90 seconds' WHERE id = $1`,
      [ending],
    );
    await pool.query(
      `UPDATE requests SET expires_at = now() + interval '3 minutes' WHERE id = $1`,
      [lasting],
    );
    await reopen(shop);
    await catchUp(shop.shopId);
    expect(await pingCount(ending)).toBe(0);
    expect(await pingCount(lasting, shop.shopId)).toBe(1);
  });

  it('skips a request that already has its answers (answered) or its maximum of pings', async () => {
    const shop = await makeShop(['grocery'], 0.3, false);
    const answered = await pinging('chini');
    await pool.query(`UPDATE requests SET state = 'ANSWERED' WHERE id = $1`, [answered]);
    const full = await pinging('namak');
    const other = await makeShop(['grocery'], 0.5);
    await fan(full); // `other` is asked: 1 ping
    expect(await pingCount(full)).toBe(1);
    await reopen(shop);
    await catchUp(shop.shopId, allow, 1); // the cap is 1 ping per request
    expect(await pingCount(answered)).toBe(0);
    expect(await pingCount(full, shop.shopId)).toBe(0);
    expect(other.shopId).toBeTruthy();
  });

  it('only asks about items of the shop’s own categories, inside the request radius', async () => {
    const shop = await makeShop(['hardware'], 0.3);
    const grocery = await pinging('chini');
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 0 });
    expect(await pingCount(grocery)).toBe(0);

    const far = await makeShop(['grocery'], 4.5);
    expect(await catchUp(far.shopId)).toMatchObject({ sent: 0 }); // outside the 2 km radius
  });

  it('does nothing for a shop that is still closed', async () => {
    const shop = await makeShop(['grocery'], 0.3, false);
    const id = await pinging();
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 0 });
    expect(await pingCount(id)).toBe(0);
  });

  it('respects the per-shop dedupe window: a shop asked about the item a moment ago is not asked again', async () => {
    const shop = await makeShop();
    const id = await pinging();
    const refusing: PingClaims = { claim: async () => false, release: async () => undefined };
    expect(await catchUp(shop.shopId, refusing)).toMatchObject({ sent: 0 });
    expect(await pingCount(id)).toBe(0);
  });

  it('does not ask a shop that already has fresh learned stock of the item', async () => {
    const shop = await makeShop();
    const id = await pinging();
    await pool.query(
      `INSERT INTO shop_stock (shop_id, item_id, source, last_confirmed_at, expires_at)
       SELECT $1, item_id, 'ping_yes', now(), now() + interval '7 days' FROM requests WHERE id = $2`,
      [shop.shopId, id],
    );
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 0 });
  });

  it('a simulated shop is asked the same way, and the simulator is told on the admin stream', async () => {
    const shop = await makeShop();
    await pool.query(`UPDATE shops SET is_simulated = true WHERE id = $1`, [shop.shopId]);
    const id = await pinging();
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 1 });
    expect(await pingCount(id, shop.shopId)).toBe(1);
    const told = events.find((e) => e.type === 'ping.created' && 'admin' in e.to);
    expect(told?.data).toMatchObject({ shopId: shop.shopId, item: { slug: 'sugar' } });
  });

  it('is quiet when there is nothing to catch up on, and for a shop that does not exist', async () => {
    const shop = await makeShop();
    expect(await catchUp(shop.shopId)).toMatchObject({ sent: 0 });
    expect(await catchUp('00000000-0000-4000-8000-000000000000')).toMatchObject({ sent: 0 });
  });

  it('shops the simulator creates are caught up too', async () => {
    const queued: string[] = [];
    const adminApp = createApp({
      config: testConfig({ adminPhones: ['+919810000555'] }),
      logger: quiet,
      db: pool,
      realtime,
      requestHooks: { enqueueShopCatchUp: async (id) => void queued.push(id) },
    });
    const admin = await loginAs(adminApp, 'seeker', '9810000555');
    const res = await request(adminApp)
      .post('/admin/sim/shops')
      .set(auth(admin))
      .send({ count: 2, centre: { lat: ORIGIN.lat, lng: ORIGIN.lng }, radiusM: 500, seed: 9 });
    expect(res.status).toBe(201);
    expect(queued.sort()).toEqual(res.body.map((s: { shopId: string }) => s.shopId).sort());
  });
});
