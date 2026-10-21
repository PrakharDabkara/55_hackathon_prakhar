import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { fanOutPings } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const quiet = pino({ level: 'silent' });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

// ADR-0055 rule 13: "stop asking" for a single search and for a list.
describe('stop asking (S45)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_800_300_000;
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
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'shopping_lists, requests, pings, delivery_orders, shop_stock',
    );
    await pool.query('DELETE FROM shops');
    events.length = 0;
  });

  const customer = () => loginAs(app, 'seeker', String(phone++));
  async function shop(name: string, km: number, extra: Json = {}): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, ...extra });
    return { ...owner, shopId: made.body.id as string };
  }
  const deleteAccount = (u: { token: string }) => request(app).delete('/account').set(auth(u));

  it('a single search: Stop closes it, withdraws the open pings and the account can be deleted', async () => {
    const me = await customer();
    const a = await shop('A', 0.2, { delivery: { feePaise: 1000 } });
    const b = await shop('B', 0.3);
    const made = await request(app)
      .post('/requests')
      .set(auth(me))
      .send({ q: 'chini', lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(made.status).toBe(201);
    await fanOutPings(
      { db: pool, logger: quiet, config: { maxPings: 10 }, events: realtime.events },
      made.body.id,
      { claim: async () => true, release: async () => undefined },
    );
    const pingA = (await pool.query(`SELECT id FROM pings WHERE shop_id = $1`, [a.shopId])).rows[0]
      .id;
    expect(
      (
        await request(app)
          .post(`/pings/${pingA}/answer`)
          .set(auth(a))
          .send({ answer: 'yes', pricePaise: 4800, delivery: { feePaise: 1000 } })
      ).status,
    ).toBe(200);

    expect((await deleteAccount(me)).status).toBe(409);
    const stop = await request(app).post(`/requests/${made.body.id}/close`).set(auth(me));
    expect(stop.status).toBe(200);
    expect(stop.body.state).toBe('CLOSED');
    expect(
      (await pool.query(`SELECT state FROM pings WHERE shop_id = $1`, [b.shopId])).rows[0].state,
    ).toBe('NO_REPLY');
    expect((await request(app).get('/shops/me/pings').set(auth(b))).body).toHaveLength(0);

    // Its answers are no longer binding: an order from them waits for the shop.
    const order = await request(app)
      .post('/orders')
      .set(auth(me))
      .send({ requestId: made.body.id, shopId: a.shopId, addressText: ADDRESS });
    expect(order.status).toBe(201);
    expect(order.body.state).toBe('REQUESTED');
    await request(app).post(`/orders/${order.body.id}/cancel`).set(auth(me)).send({});
    expect((await deleteAccount(me)).status).toBe(204);
  });

  describe('a list', () => {
    async function liveList(me: { token: string }) {
      const g = await shop('Grocer', 0.3);
      const sorted = await request(app)
        .post('/lists/sort')
        .set(auth(me))
        .send({ lines: ['chini'] });
      const sent = await request(app)
        .post(`/lists/${sorted.body.id}/send`)
        .set(auth(me))
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
      expect(sent.status).toBe(200);
      return { g, id: sorted.body.id as string };
    }

    it('a live list blocks account deletion; Stop makes it STOPPED, withdraws the parchi and lets the account go', async () => {
      const me = await customer();
      const { g, id } = await liveList(me);
      const deleted = await deleteAccount(me);
      expect(deleted.status).toBe(409);
      events.length = 0;
      const stop = await request(app).post(`/lists/${id}/stop`).set(auth(me));
      expect(stop.status).toBe(200);
      expect(stop.body).toMatchObject({ state: 'STOPPED', listening: false });
      expect((await request(app).get('/shops/me/lists').set(auth(g))).body).toHaveLength(0);
      expect(
        events.some(
          (e) => e.type === 'listping.closed' && 'userId' in e.to && e.to.userId === g.userId,
        ),
      ).toBe(true);
      expect((await deleteAccount(me)).status).toBe(204);
    });

    it('stopping twice is harmless; a stopped list takes no answers and cannot be ordered from', async () => {
      const me = await customer();
      const { g, id } = await liveList(me);
      const parchi = (await request(app).get('/shops/me/lists').set(auth(g))).body[0];
      await request(app).post(`/lists/${id}/stop`).set(auth(me));
      expect((await request(app).post(`/lists/${id}/stop`).set(auth(me))).body.state).toBe(
        'STOPPED',
      );
      const late = await request(app)
        .post(`/list-pings/${parchi.id}/answer`)
        .set(auth(g))
        .send({
          lines: parchi.lines.map((l: Json) => ({ lineId: l.lineId, have: true, priceRupees: 40 })),
        });
      expect(late.status).toBe(409);
      const order = await request(app)
        .post(`/lists/${id}/order`)
        .set(auth(me))
        .send({ assignments: [{ position: 0, shopId: g.shopId }], modes: {} });
      expect(order.status).toBe(409);
    });

    it('someone else cannot stop it, and an ordered list is left as it is', async () => {
      const me = await customer();
      const other = await customer();
      const { id } = await liveList(me);
      expect((await request(app).post(`/lists/${id}/stop`).set(auth(other))).status).toBe(404);
      await pool.query(`UPDATE shopping_lists SET state = 'ORDERED' WHERE id = $1`, [id]);
      expect((await request(app).post(`/lists/${id}/stop`).set(auth(me))).body.state).toBe(
        'ORDERED',
      );
    });

    it('a draft that was never sent does not block deleting the account', async () => {
      const me = await customer();
      await request(app)
        .post('/lists/sort')
        .set(auth(me))
        .send({ lines: ['chini'] });
      expect((await deleteAccount(me)).status).toBe(204);
    });
  });
});
