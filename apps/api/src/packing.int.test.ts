import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const quiet = pino({ level: 'silent' });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ADR-0055 rule 12: the shop ticks lines as packed. Works for any delivery order.
describe('packing an order (S43)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let seeker: { token: string; userId: string };
  let shopA: { token: string; userId: string; shopId: string };
  let shopB: { token: string; userId: string; shopId: string };
  let phone = 9_800_200_000;
  const events: RealtimeEvent[] = [];
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    realtime.onPublish((e) => events.push(e));
    app = createApp({ config: testConfig(), logger: quiet, db: pool, realtime });
    seeker = await loginAs(app, 'seeker', String(phone++));
    const make = async (name: string, km: number) => {
      const owner = await loginAs(app, 'shop', String(phone++));
      const made = await request(app)
        .post('/shops')
        .set(auth(owner))
        .send({ name, lat: north(km), lng: ORIGIN.lng });
      return { ...owner, shopId: made.body.id as string };
    };
    shopA = await make('A', 0.2);
    shopB = await make('B', 0.4);
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'delivery_orders');
    events.length = 0;
  });

  const LINES = [
    { name: 'Sugar', count: 1, pricePaise: 4800 },
    { name: 'Rice', count: 1, pricePaise: 6000 },
    { name: 'Bolt', count: 1, pricePaise: null },
    { name: 'Pen', count: 1, pricePaise: 1000 },
  ];
  async function makeOrder(state = 'ACCEPTED', source: 'request' | 'errand' = 'request') {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO delivery_orders (user_id, shop_id, source_id, state, lines, address_text, lat, lng, expires_at)
       VALUES ($1, $2, gen_random_uuid(), $3, $4::jsonb, 'Flat 4B, Vijay Nagar', 22.7, 75.8, now() + interval '1 hour')
       RETURNING id`,
      [seeker.userId, shopA.shopId, state, JSON.stringify(LINES)],
    );
    void source;
    return (rows[0] as { id: string }).id;
  }
  const pack = (id: string, index: number, packed: boolean, user: { token: string } = shopA) =>
    request(app).put(`/orders/${id}/lines/${index}/packed`).set(auth(user)).send({ packed });
  const shopOrder = async (id: string) =>
    ((await request(app).get('/shops/me/orders').set(auth(shopA))).body as Json[]).find(
      (o) => o['id'] === id,
    ) as Json;

  it('the owning shop sets and clears a packed flag; the shop sees "2 of 4 packed"', async () => {
    const id = await makeOrder();
    expect((await pack(id, 0, true)).status).toBe(200);
    const res = await pack(id, 2, true);
    expect(res.body).toMatchObject({ packedCount: 2, lineCount: 4, unpackedCount: 2 });
    expect(res.body.lines.map((l: Json) => l['packed'])).toEqual([true, false, true, false]);
    expect((await shopOrder(id))['packedCount']).toBe(2);
    const cleared = await pack(id, 0, false);
    expect(cleared.body).toMatchObject({ packedCount: 1, unpackedCount: 3 });
  });

  it('ticking twice is harmless, and the customer is told with a hint, not a push-worthy state change', async () => {
    const id = await makeOrder();
    await pack(id, 1, true);
    expect((await pack(id, 1, true)).body.packedCount).toBe(1);
    const hint = events.find((e) => e.type === 'order.packed');
    expect(hint).toMatchObject({ to: { userId: seeker.userId }, data: { orderId: id } });
    expect(events.some((e) => e.type === 'order.updated')).toBe(false);
  });

  it('only the owning shop: another shop and the customer get 404', async () => {
    const id = await makeOrder();
    expect((await pack(id, 0, true, shopB)).status).toBe(404);
    expect((await pack(id, 0, true, seeker)).status).toBe(403);
    expect((await shopOrder(id))['packedCount']).toBe(0);
  });

  it('only while the order is active: REQUESTED, ACCEPTED and OUT_FOR_DELIVERY yes; the final states no', async () => {
    for (const state of ['REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY']) {
      expect((await pack(await makeOrder(state), 0, true)).status, state).toBe(200);
    }
    for (const state of ['DELIVERED', 'NOT_CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED']) {
      const res = await pack(await makeOrder(state), 0, true);
      expect(res.status, state).toBe(409);
      expect(res.body.error.code).toBe('order_closed');
    }
  });

  it('refuses a line that is not on the order', async () => {
    const id = await makeOrder();
    expect((await pack(id, 4, true)).status).toBe(404);
    expect((await pack(id, -1, true)).status).toBe(400);
  });

  it('dispatching with unpacked lines is allowed and the response says how many', async () => {
    const id = await makeOrder();
    await pack(id, 0, true);
    const res = await request(app).post(`/orders/${id}/out`).set(auth(shopA));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'OUT_FOR_DELIVERY', packedCount: 1, unpackedCount: 3 });
  });

  it('the customer sees the flags on their own order', async () => {
    const id = await makeOrder();
    await pack(id, 3, true);
    const mine = await request(app).get(`/orders/${id}`).set(auth(seeker));
    expect(mine.body.lines[3].packed).toBe(true);
    expect(mine.body.packedCount).toBe(1);
  });
});
