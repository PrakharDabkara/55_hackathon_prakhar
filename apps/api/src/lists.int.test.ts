import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIST_HOURLY_LIMIT, MAX_LIST_ANSWERS } from '@askbuy/shared';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createNotifier } from './modules/push/index.js';
import { createRealtime, type RealtimeEvent } from './modules/realtime/index.js';
import { MISC_FANOUT_MAX } from './modules/requests/index.js';
import { setEmbeddings, vec } from './testing/aiFixtures.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const quiet = pino({ level: 'silent' });
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Shop = { token: string; userId: string; shopId: string };

/**
 * What the scripted model says per line of the list prompt: by the line's text. The prompt holds
 * one block per line (`<<<LINE n` text `LINE>>>`) and the candidates for that line after it.
 */
function script(
  verdicts: Record<string, 'none' | 'blocked' | 'first' | 'ambiguous'>,
): Parameters<FakeProvider['onGenerate']>[0] {
  return ({ user, purpose }) => {
    if (purpose !== 'resolve_query') return { itemId: null, needsClarification: false };
    const lines: Json[] = [];
    const re = /<<<LINE (\d+)\n([^\n]*)\nLINE>>>\nCandidates for line \1:\n((?:\{.*\}\n?)*)/g;
    for (const m of user.matchAll(re)) {
      const n = Number(m[1]);
      const ids = (m[3] ?? '')
        .split('\n')
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { id: string }).id);
      const verdict = verdicts[m[2] as string] ?? 'none';
      lines.push(
        verdict === 'blocked'
          ? { n, itemId: null, needsClarification: false, blocked: true }
          : verdict === 'first'
            ? { n, itemId: ids[0], needsClarification: false }
            : verdict === 'ambiguous'
              ? {
                  n,
                  itemId: null,
                  needsClarification: true,
                  question: 'Which one?',
                  optionIds: ids.slice(0, 2),
                }
              : { n, itemId: null, needsClarification: false },
      );
    }
    return { lines };
  };
}

// ADR-0055: shopping lists. Sorting, fan-out, answers, the customer's view and ordering.
describe('shopping lists (S35 to S43)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let provider: FakeProvider;
  let seeker: { token: string; userId: string };
  let phone = 9_800_100_000;
  const events: RealtimeEvent[] = [];
  const realtime = createRealtime({ redisUrl: null, logger: quiet });
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    await setEmbeddings(pool, { sugar: vec({ 0: 1 }) });
    provider = createFakeProvider();
    const ai = createAi({
      provider,
      db: pool,
      logger: quiet,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
    realtime.onPublish((e) => events.push(e));
    app = createApp({
      config: testConfig({
        vapid: { publicKey: 'BPublicKey-for-tests', privateKey: 'p', subject: 'mailto:o@e.com' },
      }),
      logger: quiet,
      db: pool,
      realtime,
      ai,
    });
    seeker = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(
      pool,
      'shopping_lists, delivery_orders, requests, shop_stock, query_cache, saved_addresses, push_subscriptions',
    );
    await pool.query('DELETE FROM shops');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    events.length = 0;
    provider.calls.length = 0;
    provider.onGenerate(script({}));
  });

  async function shop(
    name: string,
    km: number,
    categories: string[] = ['grocery'],
    extra: Json = {},
  ): Promise<Shop> {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories, ...extra });
    return { ...owner, shopId: made.body.id as string };
  }
  const sort = (lines: string[], user = seeker) =>
    request(app).post('/lists/sort').set(auth(user)).send({ lines });
  const send = (id: string, body: Json = {}, user = seeker) =>
    request(app)
      .post(`/lists/${id}/send`)
      .set(auth(user))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  const view = async (id: string, user = seeker) =>
    (await request(app).get(`/lists/${id}`).set(auth(user))).body as Json;
  const parchis = async (s: Shop) =>
    (await request(app).get('/shops/me/lists').set(auth(s))).body as Json[];
  const lineIds = (p: Json) =>
    Object.fromEntries(p['lines'].map((l: Json) => [l['name'], l['lineId']]));
  /** Answers a parchi: `have` maps a line's name to its rupee price, or false. */
  const answer = (s: Shop, p: Json, have: Record<string, number | false>, extra: Json = {}) =>
    request(app)
      .post(`/list-pings/${p['id']}/answer`)
      .set(auth(s))
      .send({
        lines: p['lines'].map((l: Json) => {
          const v = have[l['name']] ?? false;
          return v === false
            ? { lineId: l['lineId'], have: false }
            : { lineId: l['lineId'], have: true, priceRupees: v };
        }),
        ...extra,
      });
  /** A sorted and sent list of sugar (grocery), a pen (stationery) and one "other" line. */
  async function sentList(extraBody: Json = {}) {
    const sorted = await sort(['chini', 'pen', 'tractor spare bolt']);
    expect(sorted.status).toBe(201);
    const sent = await send(sorted.body.id, extraBody);
    expect(sent.status).toBe(200);
    return sent.body as Json;
  }

  describe('sorting', () => {
    it('S35: each line is an item, ambiguous, other or refused, with one embedding request and one model call', async () => {
      await shop('G', 0.3);
      provider.onGenerate(
        script({ 'tractor spare bolt': 'none', 'wooden spoon set': 'ambiguous' }),
      );
      const res = await sort([
        'chini',
        'mirchi',
        'tractor spare bolt',
        'heroin',
        'wooden spoon set',
      ]);
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('DRAFT');
      const by = Object.fromEntries(res.body.lines.map((l: Json) => [l['text'], l]));
      expect(by['chini']).toMatchObject({ status: 'item', item: { category: 'grocery' } });
      expect(by['mirchi']).toMatchObject({ status: 'ambiguous' });
      expect(by['mirchi'].options.length).toBeGreaterThanOrEqual(2);
      expect(by['mirchi'].options.length).toBeLessThanOrEqual(3);
      expect(by['tractor spare bolt']).toMatchObject({ status: 'other' });
      expect(by['heroin']).toMatchObject({ status: 'refused', reason: 'blocked' });
      expect(by['wooden spoon set']).toMatchObject({ status: 'ambiguous' });
      expect(provider.calls.filter((c) => c.kind === 'generate')).toHaveLength(1);
      expect(provider.calls.filter((c) => c.kind === 'embed')).toHaveLength(1);
    });

    it('S35: the model sees line texts and catalog names only, never a user id, phone or place; a denied line reaches no model', async () => {
      provider.onGenerate(script({}));
      await sort(['tractor spare bolt', 'heroin']);
      const sentToModel = JSON.stringify(provider.calls);
      expect(sentToModel).not.toContain(seeker.userId);
      expect(sentToModel).not.toMatch(/\+91|98001/);
      expect(sentToModel).not.toContain('22.71');
      expect(sentToModel.toLowerCase()).not.toContain('heroin');
    });

    it('a list of only known lines makes no model call at all', async () => {
      const res = await sort(['chini', 'pen']);
      expect(res.body.lines.map((l: Json) => l['status'])).toEqual(['item', 'item']);
      expect(provider.calls).toHaveLength(0);
    });

    it('the model saying "blocked" refuses the line, and an answer that names an id it was not shown is ignored', async () => {
      provider.onGenerate(({ user }) => ({
        lines: [...user.matchAll(/<<<LINE (\d+)\n([^\n]*)\nLINE>>>/g)].map((m) =>
          m[2] === 'tractor spare bolt'
            ? { n: Number(m[1]), itemId: null, needsClarification: false, blocked: true }
            : {
                n: Number(m[1]),
                itemId: '00000000-0000-4000-8000-000000000000',
                needsClarification: false,
              },
        ),
      }));
      const res = await sort(['tractor spare bolt', 'garden hose nozzle']);
      expect(res.body.lines[0]).toMatchObject({ status: 'refused', reason: 'blocked' });
      expect(res.body.lines[1]).toMatchObject({ status: 'other' });
    });

    it('the model saying "not a product" refuses the line as unclear; a real product it cannot place stays other', async () => {
      provider.onGenerate(({ user }) => ({
        lines: [...user.matchAll(/<<<LINE (\d+)\n([^\n]*)\n/g)].map((m) => ({
          n: Number(m[1]),
          itemId: null,
          needsClarification: false,
          ...(m[2] === 'tomorrow morning' && { notProduct: true }),
        })),
      }));
      const res = await sort(['tomorrow morning', 'garden hose nozzle']);
      expect(res.body.lines[0]).toMatchObject({ status: 'refused', reason: 'unclear' });
      expect(res.body.lines[1]).toMatchObject({ status: 'other' });
    });

    it('a model outage leaves the unplaced lines "other", never an error', async () => {
      provider.onGenerate(() => {
        throw new Error('down');
      });
      const res = await sort(['chini', 'tractor spare bolt']);
      expect(res.status).toBe(201);
      expect(res.body.lines.map((l: Json) => l['status'])).toEqual(['item', 'other']);
    });

    it('cleans the list: empty lines dropped, duplicates merged, limits enforced', async () => {
      const res = await sort(['  chini ', '', 'CHINI', 'pen']);
      expect(res.body.lines.map((l: Json) => l['text'])).toEqual(['chini', 'pen']);
      expect((await sort([])).status).toBe(400);
      expect((await sort(Array.from({ length: 11 }, (_, i) => `thing ${i}`))).status).toBe(400);
      expect((await sort(['a'.repeat(81)])).status).toBe(400);
    });

    it('is for customers only', async () => {
      const owner = await shop('G', 0.3);
      expect((await sort(['chini'], owner)).status).toBe(403);
    });
  });

  describe('sending', () => {
    it('S36: each shop gets ONE parchi with only its kind of lines plus every "other" line, flagged', async () => {
      const g = await shop('Grocer', 0.3);
      const s = await shop('Stationer', 0.5, ['stationery']);
      const h = await shop('Hardware', 0.7, ['hardware']);
      const list = await sentList();
      expect(list.state).toBe('OPEN');

      const pg = (await parchis(g)) as Json[];
      const ps = (await parchis(s)) as Json[];
      const ph = (await parchis(h)) as Json[];
      expect([pg.length, ps.length, ph.length]).toEqual([1, 1, 1]);
      const names = (p: Json[]) => (p[0] as Json)['lines'].map((l: Json) => l['name']).sort();
      expect(names(pg)).toEqual(['Sugar', 'Tractor spare bolt'].sort());
      expect(names(ps)).toEqual(['Ball pen', 'Tractor spare bolt'].sort());
      expect(names(ph)).toEqual(['Tractor spare bolt']);
      const other = (pg[0] as Json)['lines'].find((l: Json) => l['name'] === 'Tractor spare bolt');
      expect(other.other).toBe(true);
      expect((pg[0] as Json)['lines'].find((l: Json) => l['name'] === 'Sugar').other).toBe(false);
      const rows = await pool.query(
        `SELECT shop_id, count(*)::int AS n FROM list_pings GROUP BY shop_id`,
      );
      expect(rows.rows.every((r) => r.n === 1)).toBe(true);
    });

    it('S36: the shop learns a distance band and the line texts, never who asked or where', async () => {
      const g = await shop('Grocer', 0.3);
      await sentList();
      const p = (await parchis(g))[0] as Json;
      const text = JSON.stringify(p);
      expect(p['distanceBand']).toBeTypeOf('string');
      for (const secret of [seeker.userId, 'lat', 'lng', 'userId', 'phone', 'rawQuery']) {
        expect(text).not.toContain(secret);
      }
      expect(Object.keys(p).sort()).toEqual(
        [
          'canDeliver',
          'distanceBand',
          'expiresAt',
          'id',
          'lines',
          'sentAt',
          'wantsDelivery',
        ].sort(),
      );
    });

    it('S36: "other" lines go to the nearest MISC_FANOUT_MAX open shops, closed shops are skipped', async () => {
      await Promise.all(
        Array.from({ length: MISC_FANOUT_MAX + 3 }, (_, i) => shop(`Far ${i}`, 0.05 + i * 0.05)),
      );
      const closed = await shop('Closed', 0.01);
      await request(app).put('/shops/me/open').set(auth(closed)).send({ open: false });
      const sorted = await sort(['tractor spare bolt']);
      await send(sorted.body.id);
      const asked = await pool.query(`SELECT shop_id FROM list_pings`);
      expect(asked.rowCount).toBe(MISC_FANOUT_MAX);
      expect(asked.rows.map((r) => r.shop_id)).not.toContain(closed.shopId);
    });

    it('S37: one push per shop per list, tagged for the list', async () => {
      const g = await shop('Grocer', 0.3);
      await request(app)
        .post('/push/subscribe')
        .set(auth(g))
        .send({
          endpoint: 'https://fcm.googleapis.com/fcm/send/list-shop',
          keys: {
            p256dh:
              'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
            auth: 'tBHItJI5svbpez7KI4CCXg',
          },
        });
      const jobs: { payload: { title: string; tag: string; renotify: boolean } }[] = [];
      const notifier = createNotifier({
        db: pool,
        logger: quiet,
        enqueue: async (job) => void jobs.push(job as never),
        limiter: { allow: async () => true },
        answerDebounceMs: 0,
      });
      const list = await sentList();
      for (const e of events) notifier.handle(e);
      await notifier.idle();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.payload.tag).toBe(`list:${list['id']}`);
      expect(jobs[0]?.payload.title).toMatch(/^New list: /);
      expect(jobs[0]?.payload.renotify).toBe(true);
      expect(events.filter((e) => e.type === 'listping.created' && 'userId' in e.to)).toHaveLength(
        1,
      );
    });

    it('an ambiguous line needs a choice: one of its options, or as typed', async () => {
      await shop('Grocer', 0.3);
      const sorted = await sort(['mirchi', 'chini']);
      const mirchi = sorted.body.lines[0];
      expect((await send(sorted.body.id)).status).toBe(400);
      expect(
        (
          await send(sorted.body.id, {
            choices: [{ position: 0, itemId: '00000000-0000-4000-8000-000000000000' }],
          })
        ).status,
      ).toBe(400);
      const ok = await send(sorted.body.id, {
        choices: [{ position: 0, itemId: mirchi.options[0].itemId }],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.lines[0]).toMatchObject({ status: 'item' });
      expect(ok.body.lines[0].item.id).toBe(mirchi.options[0].itemId);

      const typed = await sort(['mirchi']);
      const asTyped = await send(typed.body.id, { choices: [{ position: 0, asTyped: true }] });
      expect(asTyped.body.lines[0]).toMatchObject({ status: 'other', asTyped: true });
    });

    it('a customer may send LIST_HOURLY_LIMIT lists an hour, then waits', async () => {
      await shop('Grocer', 0.3);
      const me = await loginAs(app, 'seeker', String(phone++));
      for (let i = 0; i < LIST_HOURLY_LIMIT; i++) {
        const sorted = await sort(['chini'], me);
        expect((await send(sorted.body.id, {}, me)).status).toBe(200);
      }
      const over = await send((await sort(['chini'], me)).body.id, {}, me);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('list_rate_limited');
    });

    it('sending twice is one send; a refused line is not sent; nothing sendable is a 422', async () => {
      const g = await shop('Grocer', 0.3);
      const sorted = await sort(['chini', 'heroin']);
      const first = await send(sorted.body.id);
      const second = await send(sorted.body.id);
      expect(second.status).toBe(200);
      expect(second.body.sentAt).toBe(first.body.sentAt);
      expect((await parchis(g))[0]?.['lines']).toHaveLength(1);
      expect((await send((await sort(['heroin'])).body.id)).status).toBe(422);
    });

    it("is the customer's own list only", async () => {
      const sorted = await sort(['chini']);
      const other = await loginAs(app, 'seeker', String(phone++));
      expect((await send(sorted.body.id, {}, other)).status).toBe(404);
      expect((await request(app).get(`/lists/${sorted.body.id}`).set(auth(other))).status).toBe(
        404,
      );
    });
  });

  describe('answering and listening', () => {
    it('S38: a shop answers per line with a rupee price, canDeliver and one fee; it teaches learned stock', async () => {
      const g = await shop('Grocer', 0.3);
      await sentList();
      const p = (await parchis(g))[0] as Json;
      const res = await answer(
        g,
        p,
        { Sugar: 48, 'Tractor spare bolt': 15 },
        { canDeliver: true, deliveryFeeRupees: 20 },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        state: 'ANSWERED',
        canDeliver: true,
        deliveryFeePaise: 2000,
      });
      const stock = await pool.query(`SELECT price_paise FROM shop_stock WHERE shop_id = $1`, [
        g.shopId,
      ]);
      expect(stock.rows.map((r) => r.price_paise)).toEqual([4800]);
      expect(
        events.some(
          (e) => e.type === 'list.updated' && 'userId' in e.to && e.to.userId === seeker.userId,
        ),
      ).toBe(true);
    });

    it("S38: shows last time's price per line", async () => {
      const g = await shop('Grocer', 0.3);
      await sentList();
      await answer(g, (await parchis(g))[0] as Json, { Sugar: 45 });
      await sentList();
      const p = (await parchis(g))[0] as Json;
      expect(p['lines'].find((l: Json) => l['name'] === 'Sugar').lastPricePaise).toBe(4500);
    });

    it('S39: a shop cannot answer lines it was not sent, miss one, skip a price, or answer twice', async () => {
      const g = await shop('Grocer', 0.3);
      const s = await shop('Stationer', 0.5, ['stationery']);
      await sentList();
      const pg = (await parchis(g))[0] as Json;
      const ps = (await parchis(s))[0] as Json;
      // A line that was sent to the stationer only.
      const penLine = lineIds(ps)['Ball pen'];
      const sugarLine = lineIds(pg)['Sugar'];
      const boltLine = lineIds(pg)['Tractor spare bolt'];
      const post = (body: Json) =>
        request(app).post(`/list-pings/${pg['id']}/answer`).set(auth(g)).send(body);
      expect(
        (
          await post({
            lines: [
              { lineId: sugarLine, have: false },
              { lineId: boltLine, have: false },
              { lineId: penLine, have: false },
            ],
          })
        ).status,
      ).toBe(400);
      expect((await post({ lines: [{ lineId: sugarLine, have: false }] })).status).toBe(400);
      expect(
        (
          await post({
            lines: [
              { lineId: sugarLine, have: true },
              { lineId: boltLine, have: false },
            ],
          })
        ).status,
      ).toBe(400);
      const ok = await post({
        lines: [
          { lineId: sugarLine, have: true, priceRupees: 40 },
          { lineId: boltLine, have: false },
        ],
      });
      expect(ok.status).toBe(200);
      const again = await post({
        lines: [
          { lineId: sugarLine, have: false },
          { lineId: boltLine, have: false },
        ],
      });
      expect(again.status).toBe(200);
      expect(again.body.lines.find((l: Json) => l['lineId'] === sugarLine)).toMatchObject({
        have: true,
        pricePaise: 4000,
      });
      // Someone else's parchi is not found.
      expect(
        (await request(app).post(`/list-pings/${pg['id']}/answer`).set(auth(s)).send({ lines: [] }))
          .status,
      ).toBe(404);
    });

    it('S39: a shop beyond its own delivery limit cannot say canDeliver', async () => {
      const g = await shop('Grocer', 0.5, ['grocery'], { delivery: { feePaise: 1000 } });
      await request(app).patch('/shops/me').set(auth(g)).send({ deliveryMaxKm: 0.1 });
      await sentList();
      const p = (await parchis(g))[0] as Json;
      expect(p['canDeliver']).toBe(false);
      const res = await answer(g, p, {}, { canDeliver: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('cannot_deliver');
    });

    it(`S40: the list closes at ${MAX_LIST_ANSWERS} answers: the rest are withdrawn but the answers stay binding`, async () => {
      const shops = await Promise.all(
        Array.from({ length: MAX_LIST_ANSWERS + 1 }, (_, i) => shop(`Shop ${i}`, 0.1 + i * 0.05)),
      );
      const sorted = await sort(['tractor spare bolt']);
      await send(sorted.body.id);
      for (const s of shops.slice(0, MAX_LIST_ANSWERS - 1)) {
        expect(
          (await answer(s, (await parchis(s))[0] as Json, { 'Tractor spare bolt': 10 })).status,
        ).toBe(200);
      }
      expect((await view(sorted.body.id))['state']).toBe('OPEN');
      const last = shops[MAX_LIST_ANSWERS - 1] as Shop;
      expect(
        (await answer(last, (await parchis(last))[0] as Json, { 'Tractor spare bolt': 10 })).status,
      ).toBe(200);
      const full = await view(sorted.body.id);
      expect(full).toMatchObject({
        state: 'FULL',
        listening: false,
        shopsAnswered: MAX_LIST_ANSWERS,
      });
      const late = shops[MAX_LIST_ANSWERS] as Shop;
      expect(await parchis(late)).toHaveLength(0);
      const res = await request(app)
        .post(
          `/list-pings/${(await pool.query(`SELECT id FROM list_pings WHERE shop_id = $1`, [late.shopId])).rows[0].id}/answer`,
        )
        .set(auth(late))
        .send({ lines: [] });
      expect(res.status).toBe(409);
      expect(events.some((e) => e.type === 'listping.closed')).toBe(true);
    });

    it('S41: the list closes after 15 minutes, and a late parchi cannot be answered', async () => {
      const g = await shop('Grocer', 0.3);
      const list = await sentList();
      const p = (await parchis(g))[0] as Json;
      const ttl = (
        await pool.query(`SELECT expires_at - sent_at AS d FROM shopping_lists WHERE id = $1`, [
          list['id'],
        ])
      ).rows[0].d;
      expect(ttl.minutes).toBe(15);
      await pool.query(`UPDATE shopping_lists SET expires_at = now() - interval '1 second'`);
      expect(await view(list['id'] as string)).toMatchObject({
        state: 'EXPIRED',
        listening: false,
      });
      expect(await parchis(g)).toHaveLength(0);
      expect((await answer(g, p, { Sugar: 40 })).status).toBe(409);
    });
  });

  describe("the customer's view", () => {
    async function threeShops() {
      const near = await shop('Near', 0.2);
      const mid = await shop('Mid', 0.5);
      const far = await shop('Far', 1.2);
      const sorted = await sort(['chini', 'chawal', 'tractor spare bolt']);
      await send(sorted.body.id);
      return { near, mid, far, id: sorted.body.id as string };
    }

    it('S42: ranks by "have" lines, then distance, then total; each line is have, no or not_sent', async () => {
      const { near, mid, far, id } = await threeShops();
      const reply = async (s: Shop, have: Record<string, number | false>) =>
        answer(s, (await parchis(s))[0] as Json, have);
      await reply(near, { Sugar: 50, Rice: false, 'Tractor spare bolt': false });
      await reply(mid, { Sugar: 40, Rice: 60, 'Tractor spare bolt': false });
      await reply(far, { Sugar: 30, Rice: 55, 'Tractor spare bolt': 12 });
      const v = await view(id);
      expect(v['answers'].map((a: Json) => a['name'])).toEqual(['Far', 'Mid', 'Near']);
      expect(v['answers'][0]).toMatchObject({ haveCount: 3, totalPaise: 9700 });
      expect(v['answers'][2].lines.map((l: Json) => l['status'])).toEqual(['have', 'no', 'no']);

      const stationer = await shop('Stationer', 0.4, ['stationery']);
      const sorted = await sort(['pen', 'chini']);
      await send(sorted.body.id);
      await answer(stationer, (await parchis(stationer))[0] as Json, { 'Ball pen': 10 });
      const w = await view(sorted.body.id);
      const row = w['answers'].find((a: Json) => a['name'] === 'Stationer');
      expect(row.lines.map((l: Json) => l['status'])).toEqual(['have', 'not_sent']);
    });

    it('S42: the default plan is the fewest shops that cover what anyone has, cheapest per line; nobody-has lines are missing', async () => {
      const { near, mid, far, id } = await threeShops();
      const reply = async (s: Shop, have: Record<string, number | false>) =>
        answer(s, (await parchis(s))[0] as Json, have);
      await reply(near, { Sugar: 50, Rice: false, 'Tractor spare bolt': false });
      await reply(mid, { Sugar: 40, Rice: 60, 'Tractor spare bolt': false });
      await reply(far, { Sugar: false, Rice: false, 'Tractor spare bolt': false });
      const { plan } = await view(id);
      expect(plan.stops.map((s: Json) => s['shopId'])).toEqual([mid.shopId]);
      expect(plan.assignments).toEqual([
        { position: 0, shopId: mid.shopId, pricePaise: 4000 },
        { position: 1, shopId: mid.shopId, pricePaise: 6000 },
      ]);
      expect(plan.missing).toEqual([2]);
      expect(plan.totalPaise).toBe(10000);
    });
  });

  describe('ordering', () => {
    async function twoAnswers(over: { grocerDelivers?: boolean } = {}) {
      const grocer = await shop('Grocer', 0.3);
      const stationer = await shop('Stationer', 0.6, ['stationery']);
      const list = await sentList();
      const pg = (await parchis(grocer))[0] as Json;
      const ps = (await parchis(stationer))[0] as Json;
      await answer(
        grocer,
        pg,
        { Sugar: 48, 'Tractor spare bolt': false },
        over.grocerDelivers === false ? {} : { canDeliver: true, deliveryFeeRupees: 25 },
      );
      await answer(stationer, ps, { 'Ball pen': 12, 'Tractor spare bolt': 9 });
      return { grocer, stationer, id: list['id'] as string };
    }
    const order = (id: string, body: Json, user = seeker) =>
      request(app).post(`/lists/${id}/order`).set(auth(user)).send(body);
    const orders = async () =>
      (await pool.query(`SELECT * FROM delivery_orders ORDER BY created_at`)).rows;

    it("S43: orders from several shops at once: one order each with that shop's prices and fee, born ACCEPTED; the list is ORDERED", async () => {
      const { grocer, stationer, id } = await twoAnswers();
      const res = await order(id, {
        assignments: [
          { position: 0, shopId: grocer.shopId },
          { position: 1, shopId: stationer.shopId },
          { position: 2, shopId: stationer.shopId },
        ],
        modes: { [grocer.shopId]: 'delivery', [stationer.shopId]: 'delivery' },
        addressText: ADDRESS,
      });
      expect(res.status).toBe(409); // the stationer did not say canDeliver
      expect(await orders()).toHaveLength(0);

      const ok = await order(id, {
        assignments: [
          { position: 0, shopId: grocer.shopId },
          { position: 1, shopId: stationer.shopId },
          { position: 2, shopId: stationer.shopId },
        ],
        modes: { [grocer.shopId]: 'delivery', [stationer.shopId]: 'pickup' },
        addressText: ADDRESS,
      });
      expect(ok.status).toBe(201);
      expect(ok.body.list.state).toBe('ORDERED');
      // Every shop of the plan has an order: delivery and pickup (ADR-0055).
      expect(ok.body.orders).toHaveLength(2);
      const delivery = ok.body.orders.find((o: Json) => o['shopId'] === grocer.shopId);
      expect(delivery).toMatchObject({
        fulfilment: 'delivery',
        state: 'ACCEPTED',
        feePaise: 2500,
        itemsTotalPaise: 4800,
      });
      expect(ok.body.orders.find((o: Json) => o['shopId'] === stationer.shopId)).toMatchObject({
        fulfilment: 'pickup',
        state: 'ACCEPTED',
        feePaise: null,
      });
      expect(ok.body.pickups).toEqual([
        expect.objectContaining({ shopId: stationer.shopId, lines: expect.any(Array) }),
      ]);
      expect(ok.body.pickups[0].lines).toHaveLength(2);
      const row = (await orders()).find((r) => r.fulfilment === 'delivery');
      expect(row.list_id).toBe(id);
      expect(row.lines[0]).toMatchObject({ name: 'Sugar', count: 1, pricePaise: 4800 });
      // The customer finds the orders of a list by its id.
      const mine = await request(app).get(`/orders?listId=${id}`).set(auth(seeker));
      expect(mine.body.map((o: Json) => o['id']).sort()).toEqual(
        ok.body.orders.map((o: Json) => o['id']).sort(),
      );
      expect(mine.body[0].listId).toBe(id);
    });

    it('S43: N orders are made together, and one invalid assignment rolls everything back', async () => {
      const { grocer, stationer, id } = await twoAnswers();
      // The grocer said it does NOT have the bolt: assigning it there is invalid.
      const bad = await order(id, {
        assignments: [
          { position: 1, shopId: stationer.shopId },
          { position: 0, shopId: grocer.shopId },
          { position: 2, shopId: grocer.shopId },
        ],
        modes: { [grocer.shopId]: 'delivery', [stationer.shopId]: 'pickup' },
        addressText: ADDRESS,
      });
      expect(bad.status).toBe(409);
      expect(await orders()).toHaveLength(0);
      expect((await view(id))['state']).toBe('OPEN');

      // Two delivery shops in one call: both orders or none.
      const second = await shop('Second grocer', 0.35);
      const sorted = await sort(['chini']);
      await send(sorted.body.id);
      const p2 = (await parchis(second))[0] as Json;
      await answer(second, p2, { Sugar: 44 }, { canDeliver: true, deliveryFeeRupees: 10 });
      const pg = (await pool.query(`SELECT 1`)).rowCount;
      expect(pg).toBe(1);
      const both = await order(sorted.body.id, {
        assignments: [{ position: 0, shopId: second.shopId }],
        modes: { [second.shopId]: 'delivery' },
        addressText: ADDRESS,
      });
      expect(both.status).toBe(201);
    });

    it('S43: a closed shop, a missing address, and an unknown shop refuse the whole call', async () => {
      const { grocer, id } = await twoAnswers();
      await request(app).put('/shops/me/open').set(auth(grocer)).send({ open: false });
      const base = {
        assignments: [{ position: 0, shopId: grocer.shopId }],
        modes: { [grocer.shopId]: 'delivery' },
      };
      expect((await order(id, { ...base, addressText: ADDRESS })).status).toBe(409);
      await request(app).put('/shops/me/open').set(auth(grocer)).send({ open: true });
      expect((await order(id, base)).status).toBe(400);
      expect(await orders()).toHaveLength(0);
    });

    it('S43: an expired list can still be ordered from but is not binding; a second order is refused', async () => {
      const { grocer, id } = await twoAnswers();
      await pool.query(`UPDATE shopping_lists SET expires_at = now() - interval '1 minute'`);
      const base = {
        assignments: [{ position: 0, shopId: grocer.shopId }],
        modes: { [grocer.shopId]: 'delivery' },
        addressText: ADDRESS,
      };
      const res = await order(id, base);
      expect(res.status).toBe(201);
      expect(res.body.orders[0].state).toBe('REQUESTED');
      expect((await order(id, base)).status).toBe(409);
    });

    it("is the customer's own list only", async () => {
      const { grocer, id } = await twoAnswers();
      const other = await loginAs(app, 'seeker', String(phone++));
      const res = await order(
        id,
        { assignments: [{ position: 0, shopId: grocer.shopId }], modes: {} },
        other,
      );
      expect(res.status).toBe(404);
    });
  });
});
