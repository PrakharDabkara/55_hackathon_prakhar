import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createDemoAutopilot, type DemoAutopilot } from './modules/demo/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { createRequest, fanOutPings, type RequestsContext } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { startRedis } from './testing/startRedis.js';
import { truncateKeepingShops } from './testing/truncate.js';
import { waitFor } from './testing/waitFor.js';
import { startDemoAutopilotWorker, type DemoAutopilotWorker } from './workers/demoAutopilot.js';
import { startWorkers } from './workers/index.js';
import { connect } from './workers/redis.js';

const quiet = pino({ level: 'silent' });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Shop = { token: string; userId: string; shopId: string };

// ADR-0062: the demo autopilot answers for is_simulated shops, from inside the API, and for no one else.
describe('demo autopilot', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let app: ReturnType<typeof createApp>;
  let seeker: { token: string; userId: string };
  let phone = 9_700_100_000;
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const open: DemoAutopilot[] = [];

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({ config: testConfig(), logger: quiet, db: pool, realtime });
    seeker = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
    await redis?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'shopping_lists, delivery_orders, requests, shop_stock, saved_addresses',
    );
    await pool.query('DELETE FROM shops');
  });
  afterEach(async () => {
    for (const a of open.splice(0)) a.close();
    await Promise.all(queues.splice(0).map((q) => q.close()));
  });

  const queues: DemoAutopilotWorker[] = [];
  let queueNo = 0;
  /** Fast and eager by default: delays of a few ms, every shop answers. Its own queue each time. */
  const start = (over: Partial<Parameters<typeof createDemoAutopilot>[0]> = {}) => {
    const made: { worker?: DemoAutopilotWorker } = {};
    const a = createDemoAutopilot({
      db: pool,
      logger: quiet,
      events: realtime.events,
      queue: {
        enqueue: (job, options) => (made.worker as DemoAutopilotWorker).enqueue(job, options),
      },
      lists: { maxPings: 10, trigramThreshold: 0.4 },
      maxPerMinute: 1000,
      speed: 1000,
      eager: true,
      ...over,
    });
    const worker = (made.worker = startDemoAutopilotWorker({
      redisUrl: redis.url,
      logger: quiet,
      run: (job) => a.run(job),
      queueName: `demo-autopilot-test-${queueNo++}`,
    }));
    queues.push(worker);
    open.push(a);
    return a;
  };

  async function shop(
    name: string,
    km: number,
    kind: 'real' | 'simulated' | 'demo',
    categories = ['grocery'],
  ): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories });
    const shopId = made.body.id as string;
    if (kind === 'simulated')
      await pool.query(`UPDATE shops SET is_simulated = true WHERE id = $1`, [shopId]);
    if (kind === 'demo')
      await pool.query(`UPDATE shops SET is_demo = true WHERE id = $1`, [shopId]);
    return { ...owner, shopId };
  }

  const requestsCtx = (): RequestsContext => ({
    db: pool,
    logger: quiet,
    config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
  });
  const claims = { claim: async () => true, release: async () => undefined };
  /** A haldi request, fanned out to every shop near (too few kirana: all of them are asked). */
  async function ping(): Promise<string> {
    const { request: r } = await createRequest(requestsCtx(), seeker.userId, {
      q: 'haldi',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
    });
    await fanOutPings({ db: pool, logger: quiet, config: { maxPings: 10 } }, r.id, claims);
    return r.id;
  }
  const pingStates = async (requestId: string) =>
    Object.fromEntries(
      (
        await pool.query<{ shop_id: string; state: string }>(
          `SELECT shop_id, state FROM pings WHERE request_id = $1`,
          [requestId],
        )
      ).rows.map((r) => [r.shop_id, r.state]),
    );
  const settled = (requestId: string, shopId: string) =>
    waitFor(
      () => pingStates(requestId),
      (s) => s[shopId] !== 'SENT',
    );

  describe('pings', () => {
    it('answers a simulated shop through the same code path as the shop app, and teaches its stock', async () => {
      const sim = await shop('Sim', 0.3, 'simulated');
      const requestId = await ping();
      const autopilot = start();
      expect(await autopilot.catchUp()).toBe(1);
      const states = await settled(requestId, sim.shopId);
      expect(states[sim.shopId]).toMatch(/^(YES|NO)$/);
      expect(autopilot.stats().answered).toBe(1);
      if (states[sim.shopId] === 'YES')
        expect(
          (await pool.query(`SELECT 1 FROM shop_stock WHERE shop_id = $1`, [sim.shopId])).rows,
        ).toHaveLength(1);
    });

    it('ignores real shops and demo shops, even when an event names them', async () => {
      const realShop = await shop('Real', 0.2, 'real');
      const demoShop = await shop('Demo', 0.25, 'demo');
      const sim = await shop('Sim', 0.3, 'simulated');
      const requestId = await ping();
      const pings = (
        await pool.query<{ id: string; shop_id: string }>(
          `SELECT id, shop_id FROM pings WHERE request_id = $1`,
          [requestId],
        )
      ).rows;
      expect(pings).toHaveLength(3);
      const autopilot = start();
      // A forged or stray event for the real and the demo shop's pings.
      for (const p of pings.filter((p) => p.shop_id !== sim.shopId))
        autopilot.onEvent({ to: { admin: true }, type: 'ping.created', data: { pingId: p.id } });
      await autopilot.catchUp();
      const states = await settled(requestId, sim.shopId);
      await autopilot.idle();
      await new Promise((r) => setTimeout(r, 300));
      const after = await pingStates(requestId);
      expect(after[sim.shopId]).not.toBe('SENT');
      expect(after[realShop.shopId]).toBe('SENT');
      expect(after[demoShop.shopId]).toBe('SENT');
      expect(states[sim.shopId]).not.toBe('SENT');
      expect(autopilot.stats().scheduled).toBe(1);
    });

    it('reacts to the ping.created event for the admin, and to nothing else', async () => {
      const sim = await shop('Sim', 0.3, 'simulated');
      const requestId = await ping();
      const id = (
        await pool.query<{ id: string }>(`SELECT id FROM pings WHERE request_id = $1`, [requestId])
      ).rows[0]?.id;
      const autopilot = start();
      const owner: RealtimeEvent = {
        to: { userId: sim.userId },
        type: 'ping.created',
        data: { pingId: id },
      };
      autopilot.onEvent(owner);
      autopilot.onEvent({ to: { admin: true }, type: 'request.updated', data: { pingId: id } });
      autopilot.onEvent({
        to: { admin: true },
        type: 'ping.created',
        data: { pingId: 'not-a-uuid' },
      });
      autopilot.onEvent({ to: { admin: true }, type: 'ping.created', data: null });
      expect(autopilot.stats().pending).toBe(0); // nothing was even queued
      autopilot.onEvent({ to: { admin: true }, type: 'ping.created', data: { pingId: id } });
      const states = await settled(requestId, sim.shopId);
      expect(states[sim.shopId]).not.toBe('SENT');
    });

    it('waits 5 to 90 seconds at real speed, and never answers twice', async () => {
      await shop('Sim A', 0.3, 'simulated');
      await shop('Sim B', 0.35, 'simulated');
      await ping();
      const autopilot = start({ speed: 1 });
      expect(await autopilot.catchUp()).toBe(2);
      await autopilot.idle();
      expect(await autopilot.catchUp()).toBe(0); // the same pings again: the jobs are already there
      const { delaysMs, scheduled } = autopilot.stats();
      expect(scheduled).toBe(2);
      expect(delaysMs).toHaveLength(2);
      for (const d of delaysMs) {
        expect(d).toBeGreaterThanOrEqual(5000);
        expect(d).toBeLessThanOrEqual(90_000);
      }
    });

    it('is capped: past maxPerMinute the shop simply does not answer', async () => {
      for (let i = 0; i < 5; i++) await shop(`Sim ${i}`, 0.2 + i / 20, 'simulated');
      await ping();
      const autopilot = start({ maxPerMinute: 2 });
      await autopilot.catchUp();
      await autopilot.idle();
      expect(autopilot.stats()).toMatchObject({ scheduled: 2, skippedByCap: 3 });
    });
  });

  describe('catch-up after the instance slept', () => {
    it('answers pings still inside their time limit, and leaves expired and answered ones alone', async () => {
      const slow = await shop('Slow', 0.3, 'simulated');
      const requestId = await ping();
      // The instance slept for ten minutes; the request has five left.
      await pool.query(
        `UPDATE pings SET sent_at = now() - interval '10 minutes' WHERE request_id = $1`,
        [requestId],
      );
      await pool.query(
        `UPDATE requests SET created_at = now() - interval '10 minutes', expires_at = now() + interval '5 minutes' WHERE id = $1`,
        [requestId],
      );
      const autopilot = start();
      expect(await autopilot.catchUp()).toBe(1);
      expect((await settled(requestId, slow.shopId))[slow.shopId]).not.toBe('SENT');

      // A request past its deadline that nothing has expired yet is left alone.
      await pool.query('DELETE FROM requests');
      const late = await shop('Late', 0.32, 'simulated');
      const lateId = await ping();
      await pool.query(
        `UPDATE requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [lateId],
      );
      const second = start();
      expect(await second.catchUp()).toBe(0);
      await new Promise((r) => setTimeout(r, 200));
      expect((await pingStates(lateId))[late.shopId]).toBe('SENT');
    });

    it('never plans an answer for after the request ends', async () => {
      await shop('Sim', 0.3, 'simulated');
      const requestId = await ping();
      await pool.query(
        `UPDATE requests SET expires_at = now() + interval '20 seconds' WHERE id = $1`,
        [requestId],
      );
      const autopilot = start({ speed: 1 });
      await autopilot.catchUp();
      await autopilot.idle();
      const [delay] = autopilot.stats().delaysMs;
      expect(delay).toBeLessThanOrEqual(20_000);
      // And one with under 5 seconds left is not worth an answer.
      await pool.query(
        `UPDATE requests SET expires_at = now() + interval '3 seconds' WHERE id = $1`,
        [requestId],
      );
      const fresh = start({ speed: 1 });
      await fresh.catchUp();
      await fresh.idle();
      expect(fresh.stats().scheduled).toBe(0);
    });
  });

  describe('lists and orders', () => {
    const sortAndSend = async () => {
      const sorted = await request(app)
        .post('/lists/sort')
        .set(auth(seeker))
        .send({ lines: ['chini', 'chawal'] });
      await request(app)
        .post(`/lists/${sorted.body.id}/send`)
        .set(auth(seeker))
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
      return sorted.body.id as string;
    };

    it('answers a shopping-list parchi for a simulated shop only', async () => {
      const sim = await shop('Sim', 0.3, 'simulated');
      const realShop = await shop('Real', 0.35, 'real');
      await sortAndSend();
      const autopilot = start();
      expect(await autopilot.catchUp()).toBe(1);
      const states = () =>
        pool
          .query<{ shop_id: string; state: string }>(`SELECT shop_id, state FROM list_pings`)
          .then((r) => Object.fromEntries(r.rows.map((x) => [x.shop_id, x.state])));
      const done = await waitFor(states, (s) => s[sim.shopId] === 'ANSWERED');
      expect(done[sim.shopId]).toBe('ANSWERED');
      expect(done[realShop.shopId]).toBe('SENT');
    });

    /** A list answered by a simulated shop and a real one, then ordered from both in the given modes. */
    async function ordered(simMode: 'pickup' | 'delivery', realMode: 'pickup' | 'delivery') {
      const sim = await shop('Sim', 0.3, 'simulated');
      const realShop = await shop('Real', 0.35, 'real');
      const id = await sortAndSend();
      const reply = async (s: Shop, extra: Json) => {
        const p = (await request(app).get('/shops/me/lists').set(auth(s))).body[0];
        await request(app)
          .post(`/list-pings/${p.id}/answer`)
          .set(auth(s))
          .send({
            lines: p.lines.map((l: Json) => ({ lineId: l.lineId, have: true, priceRupees: 50 })),
            ...extra,
          });
      };
      await reply(sim, { canDeliver: true, deliveryFeeRupees: 20 });
      await reply(realShop, { canDeliver: true, deliveryFeeRupees: 20 });
      const placed = await request(app)
        .post(`/lists/${id}/order`)
        .set(auth(seeker))
        .send({
          assignments: [
            { position: 0, shopId: sim.shopId },
            { position: 1, shopId: realShop.shopId },
          ],
          modes: { [sim.shopId]: simMode, [realShop.shopId]: realMode },
          addressText: 'DEMO address, Vijay Nagar, Indore',
          customerName: 'Asha',
        });
      expect(placed.status).toBe(201);
      const stateOf = async (shopId: string) =>
        (
          await pool.query<{ state: string }>(
            `SELECT state FROM delivery_orders WHERE shop_id = $1`,
            [shopId],
          )
        ).rows[0]?.state as string;
      return { sim, realShop, stateOf };
    }

    it("makes a pickup order READY, and leaves a real shop's order alone", async () => {
      const { sim, realShop, stateOf } = await ordered('pickup', 'delivery');
      const autopilot = start();
      await autopilot.catchUp();
      expect(
        await waitFor(
          () => stateOf(sim.shopId),
          (s) => s === 'READY',
        ),
      ).toBe('READY');
      expect(await stateOf(realShop.shopId)).toBe('ACCEPTED');
    });

    it('sends a delivery order out, never declines, and takes an order that is still REQUESTED through accept first', async () => {
      const { sim, realShop, stateOf } = await ordered('delivery', 'pickup');
      await pool.query(`UPDATE delivery_orders SET state = 'REQUESTED' WHERE shop_id = $1`, [
        sim.shopId,
      ]);
      const autopilot = start();
      await autopilot.catchUp();
      expect(
        await waitFor(
          () => stateOf(sim.shopId),
          (s) => s === 'OUT_FOR_DELIVERY',
        ),
      ).toBe('OUT_FOR_DELIVERY');
      expect(await stateOf(realShop.shopId)).toBe('ACCEPTED');
    });
  });

  describe('the switch', () => {
    const redisConfig = (demoAutopilot: boolean) =>
      testConfig({
        workersEnabled: true,
        redisUrl: redis.url,
        demoAutopilot,
        demoAutopilotMaxPerMinute: 30,
      });
    const run = async (demoAutopilot: boolean) => {
      const workers = startWorkers({
        config: redisConfig(demoAutopilot),
        db: pool,
        logger: quiet,
        events: realtime.events,
        subscribe: realtime.onPublish,
      });
      return workers;
    };

    it('is off unless DEMO_AUTOPILOT is on: the workers have no autopilot', async () => {
      const off = await run(false);
      expect(off?.demoAutopilot).toBeNull();
      await off?.close();
      const on = await run(true);
      expect(on?.demoAutopilot).not.toBeNull();
      await on?.close();
    });

    it('leaves no trace in Redis when it is off: no queue, no jobs', async () => {
      const probe = connect(redis.url, quiet);
      await probe.flushall();
      const off = await run(false);
      await new Promise((r) => setTimeout(r, 300));
      expect(await probe.keys('bull:demo-autopilot*')).toEqual([]);
      await off?.close();
      const on = await run(true);
      await new Promise((r) => setTimeout(r, 300));
      expect((await probe.keys('bull:demo-autopilot*')).length).toBeGreaterThan(0);
      await on?.close();
      probe.disconnect();
    });

    it('does not answer anything when it is off, even for a simulated shop', async () => {
      const sim = await shop('Sim', 0.3, 'simulated');
      const requestId = await ping();
      const off = await run(false);
      await new Promise((r) => setTimeout(r, 500));
      expect((await pingStates(requestId))[sim.shopId]).toBe('SENT');
      await off?.close();
    });
  });
});
