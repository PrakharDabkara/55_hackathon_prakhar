import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_LIST_ANSWERS } from '@askbuy/shared';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { sweepLists } from './modules/lists/index.js';
import { createNotifier } from './modules/push/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const quiet = pino({ level: 'silent' });
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Shop = { token: string; userId: string; shopId: string };
type Job = {
  subscriptionId: string;
  payload: { title: string; tag: string; renotify: boolean; url: string };
};

// ADR-0055 (follow-up): the customer hears about a list's answers in ONE notification.
describe('customer push for list answers (S49)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let seeker: { token: string; userId: string };
  let phone = 9_800_500_000;
  let allow = true;
  const events: RealtimeEvent[] = [];
  const jobs: Job[] = [];
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const notifier = () =>
    createNotifier({
      db: pool,
      logger: quiet,
      enqueue: async (j) => void jobs.push(j as never),
      limiter: { allow: async () => allow },
      answerDebounceMs: 0,
    });
  let n: ReturnType<typeof notifier>;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    realtime.onPublish((e) => events.push(e));
    app = createApp({
      config: testConfig({
        vapid: { publicKey: 'BPublicKey-for-tests', privateKey: 'p', subject: 'mailto:o@e.com' },
      }),
      logger: quiet,
      db: pool,
      realtime,
    });
    n = notifier();
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'shopping_lists, delivery_orders, push_subscriptions');
    await pool.query('DELETE FROM shops');
    events.length = 0;
    jobs.length = 0;
    allow = true;
    seeker = await loginAs(app, 'seeker', String(phone++));
  });

  const subscribe = (u: { token: string }) =>
    request(app)
      .post('/push/subscribe')
      .set(auth(u))
      .send({
        endpoint: `https://fcm.googleapis.com/fcm/send/${u.token.slice(0, 12)}`,
        keys: {
          p256dh:
            'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      });
  async function shop(name: string, km: number): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories: ['grocery'] });
    return { ...owner, shopId: made.body.id as string };
  }
  const send = async (lines: string[]) => {
    const sorted = await request(app).post('/lists/sort').set(auth(seeker)).send({ lines });
    await request(app)
      .post(`/lists/${sorted.body.id}/send`)
      .set(auth(seeker))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    return sorted.body.id as string;
  };
  /** The shop answers; the haves are the first `have` lines of its parchi. */
  const answer = async (s: Shop, have: number) => {
    const p = (await request(app).get('/shops/me/lists').set(auth(s))).body[0];
    const res = await request(app)
      .post(`/list-pings/${p.id}/answer`)
      .set(auth(s))
      .send({
        lines: p.lines.map((l: Json, i: number) =>
          i < have
            ? { lineId: l.lineId, have: true, priceRupees: 10 }
            : { lineId: l.lineId, have: false },
        ),
      });
    expect(res.status).toBe(200);
  };
  /** Feeds what the app published since the last call to the notifier. */
  const flush = async () => {
    const batch = events.splice(0);
    for (const e of batch) n.handle(e);
    await n.idle();
    return jobs.splice(0);
  };

  it('the first answer renotifies "<shop> has 4 of your 5", the next ones update it quietly', async () => {
    await subscribe(seeker);
    const sharma = await shop('Sharma General Store', 0.2);
    const second = await shop('Second', 0.3);
    const third = await shop('Third', 0.4);
    const id = await send(['chini', 'namak', 'chawal', 'doodh', 'dahi']);
    await flush();

    await answer(sharma, 4);
    const first = await flush();
    expect(first).toHaveLength(1);
    expect(first[0]?.payload).toMatchObject({
      title: 'Sharma General Store has 4 of your 5',
      tag: `list:${id}`,
      renotify: true,
      url: `/app/list/${id}`,
    });

    await answer(second, 1);
    await answer(third, 0);
    const later = await flush();
    expect(later.at(-1)?.payload).toMatchObject({
      title: '3 shops answered your list',
      tag: `list:${id}`,
      renotify: false,
    });
    expect(later.every((j) => j.payload.tag === `list:${id}`)).toBe(true);
  });

  it(`when the list fills (${MAX_LIST_ANSWERS}) it renotifies once: "Your list is ready"`, async () => {
    await subscribe(seeker);
    const shops = await Promise.all(
      Array.from({ length: MAX_LIST_ANSWERS }, (_, i) => shop(`S${i}`, 0.1 + i * 0.05)),
    );
    const id = await send(['tractor spare bolt']);
    await flush();
    for (const s of shops.slice(0, -1)) await answer(s, 1);
    await flush();
    await answer(shops.at(-1) as Shop, 1);
    const last = await flush();
    expect(last).toHaveLength(1);
    expect(last[0]?.payload).toMatchObject({
      title: `Your list is ready: ${MAX_LIST_ANSWERS} shops answered`,
      tag: `list:${id}`,
      renotify: true,
    });
  });

  it('after 15 minutes (the sweeper) it renotifies once with the count; with no answers nothing is sent', async () => {
    await subscribe(seeker);
    const a = await shop('A', 0.2);
    await shop('B', 0.3);
    const quietList = await send(['chini']);
    await flush();
    await pool.query(
      `UPDATE shopping_lists SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [quietList],
    );
    await sweepLists({ db: pool, logger: quiet, events: realtime.events });
    expect(await flush()).toHaveLength(0);

    const id = await send(['namak']);
    await flush();
    await answer(a, 1);
    await flush();
    await pool.query(
      `UPDATE shopping_lists SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
    await sweepLists({ db: pool, logger: quiet, events: realtime.events });
    const done = await flush();
    expect(done).toHaveLength(1);
    expect(done[0]?.payload).toMatchObject({
      title: 'Your list is ready: 1 shop answered',
      renotify: true,
      tag: `list:${id}`,
    });
  });

  it('a list that filled and later expires does not say "ready" a second time', async () => {
    await subscribe(seeker);
    const shops = await Promise.all(
      Array.from({ length: MAX_LIST_ANSWERS }, (_, i) => shop(`S${i}`, 0.1 + i * 0.05)),
    );
    const id = await send(['tractor spare bolt']);
    for (const s of shops) await answer(s, 1);
    await flush();
    await pool.query(
      `UPDATE shopping_lists SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
    await sweepLists({ db: pool, logger: quiet, events: realtime.events });
    expect(await flush()).toHaveLength(0);
  });

  it('stopping or ordering is not news: no push', async () => {
    await subscribe(seeker);
    const a = await shop('A', 0.2);
    const id = await send(['chini']);
    await answer(a, 1);
    await flush();
    await request(app).post(`/lists/${id}/stop`).set(auth(seeker));
    expect(await flush()).toHaveLength(0);
  });

  it('respects the Reply alerts setting and the push rate limit', async () => {
    const a = await shop('A', 0.2);
    await send(['chini']);
    await answer(a, 1);
    expect(await flush()).toHaveLength(0); // no subscription: alerts are off
    await subscribe(seeker);
    allow = false;
    const b = await shop('B', 0.3);
    await send(['namak']);
    await answer(b, 1);
    expect(await flush()).toHaveLength(0); // over the limit
  });

  it('shops get nothing new, and no push carries the customer or more than a shop name and counts', async () => {
    await subscribe(seeker);
    const a = await shop('A', 0.2);
    await subscribe(a);
    await send(['chini']);
    await flush();
    await answer(a, 1);
    const sent = await flush();
    const text = JSON.stringify(sent);
    expect(text).not.toContain(seeker.userId);
    expect(
      sent.every((j) => j.payload.title.startsWith('A has') || j.payload.title.includes('list')),
    ).toBe(true);
    // The shop owner is not told about its own answer.
    expect(sent).toHaveLength(1);
  });
});
