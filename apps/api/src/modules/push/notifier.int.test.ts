import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { testConfig } from '../../testing/config.js';
import { north, ORIGIN } from '../../testing/fixtures.js';
import { loginAs } from '../../testing/login.js';
import { startPostgres, type TestDatabase } from '../../testing/startPostgres.js';
import { loadSeedCatalog, seedCatalog } from '../catalog/index.js';
import { createRealtime } from '../realtime/index.js';
import { fanOutPings, type PingClaims } from '../requests/index.js';
import { createNotifier, type EnqueuePush } from './notifier.js';
import type { PushPayload } from './payload.js';
import { createRateLimiter, type CounterStore } from './rateLimit.js';
import { saveSubscription } from './subscriptions.js';
import { truncateKeepingShops } from '../../testing/truncate.js';

const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';
const KEYS = { p256dh: 'k', auth: 'a' };

interface Queued {
  subscriptionId: string;
  payload: PushPayload;
  key?: string | undefined;
  delayMs?: number | undefined;
}

// ADR-0034: which event tells whom what, after the commit, and never a simulated shop.
describe('push notifications for the events of a search, an errand and an order', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  const quiet = pino({ level: 'silent' });
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  let phone = 9_897_000_000;
  type User = { token: string; userId: string };
  let seeker: User;
  let shop: User & { shopId: string };
  let seekerSub: string;
  let shopSub: string;
  let queued: Queued[] = [];
  let notifier: ReturnType<typeof createNotifier>;
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  /** Counts in a map the way Redis would; a test run is well inside one minute. */
  const memoryStore = (): CounterStore => {
    const counts = new Map<string, number>();
    return {
      async incr(key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts.get(key) as number;
      },
      async expire() {
        return 1;
      },
    };
  };
  const makeNotifier = (max = 5) => {
    const enqueue: EnqueuePush = async (job, options) => {
      queued.push({ ...job, ...options });
    };
    notifier = createNotifier({
      db: pool,
      logger: quiet,
      enqueue,
      limiter: createRateLimiter(memoryStore(), { max, windowSeconds: 60 }),
      answerDebounceMs: 3000,
    });
  };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    app = createApp({ config: testConfig(), logger: quiet, db: pool, realtime });
    realtime.onPublish((event) => notifier.handle(event));
    seeker = await loginAs(app, 'seeker', String(phone++));
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Push Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    shop = { ...owner, shopId: made.body.id as string };
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'requests, pings, shop_stock, delivery_orders, errands, push_subscriptions',
    );
    await pool.query(`UPDATE shops SET closed_until = NULL, is_simulated = false`);
    queued = [];
    makeNotifier();
    seekerSub = await saveSubscription(pool, seeker.userId, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/seeker',
      ...KEYS,
    });
    shopSub = await saveSubscription(pool, shop.userId, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/shop',
      ...KEYS,
    });
  });

  /** A search whose ping reaches the shop, published the way the fan-out worker does it. */
  const search = async (q = 'chini') => {
    await pool.query('DELETE FROM shop_stock');
    const made = await request(app)
      .post('/requests')
      .set(auth(seeker))
      .send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
    const requestId = made.body.id as string;
    await fanOutPings(
      { db: pool, logger: quiet, config: { maxPings: 10 }, events: realtime.events },
      requestId,
      claimsAll,
    );
    return requestId;
  };
  const answer = async (said: 'yes' | 'no' = 'yes') => {
    const pings = (await request(app).get('/shops/me/pings').set(auth(shop))).body;
    await request(app)
      .post(`/pings/${pings[0].id}/answer`)
      .set(auth(shop))
      .send(
        said === 'yes'
          ? { answer: 'yes', pricePaise: 4500, delivery: { feePaise: 3000, minutes: 45 } }
          : { answer: 'no' },
      );
  };
  const to = (subscriptionId: string) => queued.filter((q) => q.subscriptionId === subscriptionId);
  /** A stale offer (older than 30 minutes) starts REQUESTED; a fresh one is binding and starts ACCEPTED. */
  const orderOf = async (fresh = false) => {
    const requestId = await search();
    await answer('yes');
    if (!fresh)
      await pool.query(`UPDATE pings SET answered_at = answered_at - interval '31 minutes'`);
    const placed = await request(app)
      .post('/orders')
      .set(auth(seeker))
      .send({ shopId: shop.shopId, requestId, addressText: ADDRESS, customerName: 'Asha' });
    await notifier.idle();
    return { requestId, orderId: placed.body.id as string };
  };
  const act = (id: string, verb: string) =>
    request(app).post(`/orders/${id}/${verb}`).set(auth(shop));

  describe('the shop', () => {
    it('hears "Naya sawaal: <item>" for a new ping, with a link to the shop screen and nothing else', async () => {
      await search();
      await notifier.idle();
      expect(to(shopSub)).toHaveLength(1);
      const job = to(shopSub)[0] as Queued;
      expect(job.payload.title).toMatch(/^Naya sawaal: \S+/);
      expect(job.payload.url).toBe('/app/shop');
      expect(Object.keys(job.payload).sort()).toEqual(['item', 'title', 'url']);
      expect(to(seekerSub)).toHaveLength(0);
    });

    it('a shop that is closed when the question arrives is not pushed (the card waits in its list)', async () => {
      await search();
      await notifier.idle();
      const ping = (await pool.query<{ id: string }>(`SELECT id FROM pings LIMIT 1`)).rows[0];
      queued = [];
      await pool.query(`UPDATE shops SET closed_until = now() + interval '5 hours'`);
      realtime.events.publish({
        to: { userId: shop.userId },
        type: 'ping.created',
        data: { pingId: ping?.id },
      });
      await notifier.idle();
      expect(to(shopSub)).toHaveLength(0);
    });

    it('is never told when the shop is a simulated one', async () => {
      await pool.query(`UPDATE shops SET is_simulated = true`);
      await search();
      await notifier.idle();
      expect(queued).toHaveLength(0);
    });

    it('is not counted against the limit, or queued, when it has no device subscribed', async () => {
      await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [shopSub]);
      await search();
      await notifier.idle();
      expect(queued).toHaveLength(0);
    });

    it('hears "Naya order: <item>" for a new delivery order, and the customer is not told', async () => {
      await orderOf();
      const orders = to(shopSub).filter((q) => q.payload.title.startsWith('Naya order: '));
      expect(orders).toHaveLength(1);
      expect(orders[0]?.payload.url).toBe('/app/shop');
      // The customer made the order; the only push they got was for the answer that came before it.
      expect(to(seekerSub).map((q) => q.payload.title)).toEqual([
        expect.stringMatching(/^A shop replied/),
      ]);
    });

    it('hears "Grahak ne aapko chuna" instead when the customer takes a fresh offer', async () => {
      const { orderId } = await orderOf(true);
      const chosen = to(shopSub).filter((q) =>
        q.payload.title.startsWith('Grahak ne aapko chuna: '),
      );
      expect(chosen).toHaveLength(1);
      expect(chosen[0]?.payload.url).toBe('/app/shop');
      expect(to(shopSub).some((q) => q.payload.title.startsWith('Naya order: '))).toBe(false);
      expect(
        (await pool.query(`SELECT state FROM delivery_orders WHERE id = $1`, [orderId])).rows[0]
          .state,
      ).toBe('ACCEPTED');
    });

    it("sends one push to each of the shop's devices but counts it once against the limit", async () => {
      await saveSubscription(pool, shop.userId, {
        endpoint: 'https://fcm.googleapis.com/fcm/send/shop-tablet',
        ...KEYS,
      });
      makeNotifier(1);
      await search();
      await notifier.idle();
      expect(queued).toHaveLength(2);
    });
  });

  describe('the customer', () => {
    it('hears "A shop replied: <item>" once per request, a few seconds late so a burst is one', async () => {
      const requestId = await search();
      await answer('yes');
      await notifier.idle();
      const heard = to(seekerSub);
      expect(heard).toHaveLength(1);
      expect(heard[0]?.payload.title).toMatch(/^A shop replied: \S+/);
      expect(heard[0]?.payload.url).toBe(`/app/request/${requestId}`);
      expect(heard[0]?.key).toBe(`answer:${requestId}`);
      expect(heard[0]?.delayMs).toBe(3000);
    });

    it('hears nothing for a request that only got a no', async () => {
      await search();
      await answer('no');
      await notifier.idle();
      expect(to(seekerSub)).toHaveLength(0);
    });

    it('hears "Your plan is ready" when an errand is ready, and nothing while it is still planning', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO errands (user_id, task, location, state)
         VALUES ($1, 'school things', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'PLANNING')
         RETURNING id`,
        [seeker.userId, ORIGIN.lng, ORIGIN.lat],
      );
      const errandId = rows[0]?.id as string;
      realtime.events.publish({
        to: { userId: seeker.userId },
        type: 'errand.updated',
        data: { errandId, state: 'PLANNING' },
      });
      await notifier.idle();
      expect(queued).toHaveLength(0);

      await pool.query(`UPDATE errands SET state = 'PLAN_READY' WHERE id = $1`, [errandId]);
      realtime.events.publish({
        to: { userId: seeker.userId },
        type: 'errand.updated',
        data: { errandId, state: 'PLAN_READY' },
      });
      await notifier.idle();
      expect(to(seekerSub)).toHaveLength(1);
      expect(to(seekerSub)[0]).toMatchObject({
        payload: { title: 'Your plan is ready', url: `/app/errand/${errandId}` },
        key: `plan:${errandId}`,
      });
    });

    describe('while an errand is running (PR I)', () => {
      const runningErrand = async () =>
        (
          await pool.query<{ id: string }>(
            `INSERT INTO errands (user_id, task, location, state)
             VALUES ($1, 'school things', ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'WAITING_FOR_SHOPS')
             RETURNING id`,
            [seeker.userId, ORIGIN.lng, ORIGIN.lat],
          )
        ).rows[0]?.id as string;

      it('leaves the answers of the errand\'s own searches to "Your plan is ready"', async () => {
        const errandId = await runningErrand();
        const requestId = await search();
        await pool.query(
          `INSERT INTO errand_requests (errand_id, request_id, item_id)
           SELECT $1, id, item_id FROM requests WHERE id = $2`,
          [errandId, requestId],
        );
        await answer('yes');
        await notifier.idle();
        expect(to(seekerSub)).toHaveLength(0);
      });

      it('still tells the customer about a separate plain search of theirs', async () => {
        await runningErrand();
        const requestId = await search();
        await answer('yes');
        await notifier.idle();
        const heard = to(seekerSub);
        expect(heard).toHaveLength(1);
        expect(heard[0]?.payload.url).toBe(`/app/request/${requestId}`);
      });

      it('is not silenced by an errand that has finished', async () => {
        const errandId = await runningErrand();
        const requestId = await search();
        await pool.query(
          `INSERT INTO errand_requests (errand_id, request_id, item_id)
           SELECT $1, id, item_id FROM requests WHERE id = $2`,
          [errandId, requestId],
        );
        await pool.query(`UPDATE errands SET state = 'PLAN_READY' WHERE id = $1`, [errandId]);
        await answer('yes');
        await notifier.idle();
        expect(to(seekerSub)).toHaveLength(1);
      });
    });

    it('hears about an order as the shop accepts and sends it out', async () => {
      const { orderId } = await orderOf();
      queued = [];
      for (const [verb, title] of [
        ['accept', /accept/i],
        ['out', /nikla|raaste|out/i],
      ] as const) {
        await act(orderId, verb);
        await notifier.idle();
        const heard = to(seekerSub);
        expect(heard, verb).toHaveLength(1);
        expect(heard[0]?.payload.title, verb).toMatch(title);
        expect(heard[0]?.payload.url).toBe(`/app/order/${orderId}`);
        queued = [];
      }
    });

    it('tells the shop when the customer taps Received, with the existing delivered copy', async () => {
      const { orderId } = await orderOf();
      for (const verb of ['accept', 'out']) await act(orderId, verb);
      await notifier.idle();
      queued = [];
      await request(app).post(`/orders/${orderId}/received`).set(auth(seeker));
      await notifier.idle();
      expect(to(shopSub)).toHaveLength(1);
      expect(to(shopSub)[0]?.payload.title).toMatch(/pahunch/i);
      expect(to(shopSub)[0]?.payload.url).toBe('/app/shop');
      expect(to(seekerSub)).toHaveLength(0);
    });

    it('tells the customer when the shop cancels an accepted order, with the reason kept out of the push', async () => {
      const { orderId } = await orderOf();
      await act(orderId, 'accept');
      await notifier.idle();
      queued = [];
      await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set(auth(shop))
        .send({ reason: 'out_of_stock', text: 'call 9876543210' });
      await notifier.idle();
      expect(to(seekerSub)).toHaveLength(1);
      expect(to(seekerSub)[0]?.payload.title).toMatch(/cancel/i);
      expect(JSON.stringify(queued)).not.toMatch(/9876543210|out_of_stock/);
      expect(to(shopSub)).toHaveLength(0);
    });

    it('hears when the shop declines, and the shop is not told about its own tap', async () => {
      const { orderId } = await orderOf();
      queued = [];
      await act(orderId, 'decline');
      await notifier.idle();
      expect(to(seekerSub)).toHaveLength(1);
      expect(to(seekerSub)[0]?.payload.title).toMatch(/decline|mana/i);
      expect(to(shopSub)).toHaveLength(0);
    });

    it('is not pushed about its own cancel', async () => {
      const { orderId } = await orderOf();
      queued = [];
      await request(app).post(`/orders/${orderId}/cancel`).set(auth(seeker));
      await notifier.idle();
      expect(queued).toHaveLength(0);
    });
  });

  it('drops pushes past the per-user limit', async () => {
    makeNotifier(2);
    for (let i = 0; i < 4; i++) await search();
    await notifier.idle();
    expect(to(shopSub)).toHaveLength(2);
  });

  it('puts no phone number, address or coordinates in anything it queues', async () => {
    const { orderId } = await orderOf();
    for (const verb of ['accept', 'out']) await act(orderId, verb);
    await request(app).post(`/orders/${orderId}/received`).set(auth(seeker));
    await notifier.idle();
    expect(queued.length).toBeGreaterThan(3);
    const all = JSON.stringify(queued.map((q) => q.payload));
    expect(all).not.toMatch(/Sapna|Vijay|Flat|Asha/);
    // The link holds a random id; the words a person reads must hold no phone or coordinates.
    const words = JSON.stringify(queued.map((q) => [q.payload.title, q.payload.item]));
    expect(words).not.toMatch(/\d{7}/);
    expect(words).not.toMatch(/\d{2}\.\d{3,}/);
    for (const q of queued) {
      expect(Object.keys(q.payload).sort()).toEqual(['item', 'title', 'url']);
      expect(q.payload.url).toMatch(/^\/app\/(shop|request\/[\w-]+|errand\/[\w-]+|order\/[\w-]+)$/);
    }
  });
});
