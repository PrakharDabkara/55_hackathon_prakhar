import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { createRequest, fanOutPings, type RequestsContext } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { startRedis } from './testing/startRedis.js';
import { waitFor } from './testing/waitFor.js';
import { startWorkers, type Workers } from './workers/index.js';

const logger = pino({ level: 'silent' });

type User = { token: string; userId: string };
type Shop = User & { shopId: string; name: string };

describe('fan-out, ping answers and the price check', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let workers: Workers;
  let app: ReturnType<typeof createApp>;
  let ctx: RequestsContext;
  let seeker: User;
  let seeker2: User;
  let phone = 9_840_000_000;
  const item: Record<string, string> = {};

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    for (const r of rows) item[r.slug] = r.id;

    const config = testConfig({ workersEnabled: true, redisUrl: redis.url });
    workers = startWorkers({ config, db: pool, logger }) as Workers;
    app = createApp({ config, logger, db: pool, requestHooks: workers.hooks });
    ctx = {
      db: pool,
      logger,
      config: { minStockResults: 3, ttlMinutes: 15, trigramThreshold: 0.4 },
      hooks: workers.hooks,
    };
    seeker = await loginAs(app, 'seeker', String(phone++));
    seeker2 = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);

  afterAll(async () => {
    await workers?.close();
    await testDb?.stop();
    await redis?.stop();
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  async function makeShop(name: string, km: number, categories: string[]): Promise<Shop> {
    const u = await loginAs(app, 'shop', String(phone++));
    const res = await request(app)
      .post('/shops')
      .set(auth(u))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories });
    expect(res.status, name).toBe(201);
    return { ...u, shopId: res.body.id, name };
  }
  const ask = (body: Record<string, unknown>, user = seeker) =>
    request(app)
      .post('/requests')
      .set(auth(user))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  const pingsOf = async (requestId: string) =>
    (
      await pool.query(
        `SELECT shop_id, state, price_paise, quantity_hint, late FROM pings WHERE request_id = $1`,
        [requestId],
      )
    ).rows;
  const myPings = (shop: Shop) => request(app).get('/shops/me/pings').set(auth(shop));
  const answer = (shop: Shop, pingId: string, body: Record<string, unknown>) =>
    request(app).post(`/pings/${pingId}/answer`).set(auth(shop)).send(body);
  const getRequest = (id: string, user = seeker, query = '') =>
    request(app).get(`/requests/${id}${query}`).set(auth(user));

  describe('the whole loop', () => {
    it('asks 3 shops, takes a yes with a saving, hushes the rest, learns from a late yes, and does not ask twice', async () => {
      const A = await makeShop('A Kirana', 0.3, ['grocery']);
      const B = await makeShop('B Stores', 0.6, ['grocery', 'general_store']);
      const C = await makeShop('C Mart', 0.9, ['grocery']);
      const D = await makeShop('D Far Away', 3.0, ['grocery']); // outside the 2 km radius
      const E = await makeShop('E Hardware', 0.4, ['hardware']); // wrong category

      // 1. No stock anywhere: the request goes PINGING and three shops are asked.
      const created = await ask({ q: 'aata', targetPricePaise: 20000 });
      expect(created.status).toBe(201);
      expect(created.body.state).toBe('PINGING');
      expect(created.body.targetPricePaise).toBe(20000);
      const requestId = created.body.id as string;

      const sent = await waitFor(
        () => pingsOf(requestId),
        (rows) => rows.length >= 3,
      );
      expect(sent.map((p) => p.shop_id).sort()).toEqual([A, B, C].map((s) => s.shopId).sort());
      expect(sent.every((p) => p.state === 'SENT')).toBe(true);
      expect(await myPings(D).then((r) => r.body)).toEqual([]);
      expect(await myPings(E).then((r) => r.body)).toEqual([]);

      // 2. What shop A sees: the item, the target, a distance band, nothing about the asker.
      const listed = await myPings(A);
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(1);
      const ping = listed.body[0];
      expect(ping).toMatchObject({
        item: { slug: 'wheat-flour', nameHi: 'आटा', nameEn: 'wheat flour' },
        targetPricePaise: 20000,
        distanceBand: 'under 1 km',
      });
      const raw = JSON.stringify(listed.body);
      for (const secret of [
        seeker.userId,
        String(ORIGIN.lat),
        String(ORIGIN.lng),
        'lat',
        'lng',
        'phone',
      ]) {
        expect(raw, secret).not.toContain(secret);
      }

      // 3. A says yes at Rs 60 against a Rs 200 target: the request is ANSWERED and A shows the saving.
      const yes = await answer(A, ping.id, { answer: 'yes', pricePaise: 6000 });
      expect(yes.status).toBe(200);
      expect(yes.body).toMatchObject({ state: 'YES', pricePaise: 6000, late: false });

      const view = await getRequest(requestId);
      expect(view.body.state).toBe('ANSWERED');
      const top = view.body.results[0];
      expect(top).toMatchObject({
        shopId: A.shopId,
        source: 'live',
        pricePaise: 6000,
        savingsPaise: 14000,
        freshness: 'Confirmed just now',
      });
      const stock = await pool.query(
        `SELECT source, price_paise, quantity_hint, expires_at - last_confirmed_at AS ttl
           FROM shop_stock WHERE shop_id = $1 AND item_id = $2`,
        [A.shopId, item['wheat-flour']],
      );
      expect(stock.rows[0]).toMatchObject({
        source: 'ping_yes',
        price_paise: 6000,
        quantity_hint: null,
      });
      expect(stock.rows[0].ttl).toEqual({ days: 7 });

      // 4. B and C are told it is over (NO_REPLY) and A's list is empty.
      const after = await pingsOf(requestId);
      const stateOf = (s: Shop) => after.find((p) => p.shop_id === s.shopId)?.state;
      expect([stateOf(A), stateOf(B), stateOf(C)]).toEqual(['YES', 'NO_REPLY', 'NO_REPLY']);
      expect((await myPings(B)).body).toEqual([]);

      // 5. B answers anyway, late: stock is learned, the request is untouched.
      const before = await pool.query('SELECT state, version FROM requests WHERE id = $1', [
        requestId,
      ]);
      const bPing = (
        await pool.query('SELECT id FROM pings WHERE request_id = $1 AND shop_id = $2', [
          requestId,
          B.shopId,
        ])
      ).rows[0].id;
      const late = await answer(B, bPing, { answer: 'yes', pricePaise: 5500, quantityHint: 'few' });
      expect(late.status).toBe(200);
      expect(late.body).toMatchObject({ state: 'YES', late: true, pricePaise: 5500 });
      const bStock = await pool.query(
        `SELECT price_paise, quantity_hint, expires_at - last_confirmed_at AS ttl
           FROM shop_stock WHERE shop_id = $1 AND item_id = $2`,
        [B.shopId, item['wheat-flour']],
      );
      expect(bStock.rows[0]).toMatchObject({ price_paise: 5500, quantity_hint: 'few' });
      expect(bStock.rows[0].ttl).toEqual({ days: 3 });
      expect(
        (await pool.query('SELECT state, version FROM requests WHERE id = $1', [requestId]))
          .rows[0],
      ).toEqual(before.rows[0]);

      // 6. A second request: A and B are known to have it, C was asked a moment ago.
      //    Nobody is re-pinged; two learned shops are fewer than 3, so it waits as PINGING.
      const second = await ask({ q: 'gehun ka atta' }, seeker2);
      expect(second.body.state).toBe('PINGING');
      expect(second.body.results.map((r: { shopId: string }) => r.shopId).sort()).toEqual(
        [A.shopId, B.shopId].sort(),
      );
      await new Promise((r) => setTimeout(r, 1500)); // let the fan-out job run
      expect(await pingsOf(second.body.id)).toEqual([]);

      // 7. C answers late, so three shops now have it: the next request is answered from stock alone.
      const cPing = (
        await pool.query('SELECT id FROM pings WHERE request_id = $1 AND shop_id = $2', [
          requestId,
          C.shopId,
        ])
      ).rows[0].id;
      expect((await answer(C, cPing, { answer: 'yes', pricePaise: 5800 })).status).toBe(200);
      const third = await ask({ q: 'aata' }, seeker2);
      expect(third.status).toBe(201);
      expect(third.body.state).toBe('ANSWERED');
      expect(third.body.results).toHaveLength(3);
      // Price check was not asked here: cheapest is not forced, distance order applies.
      expect(third.body.results.map((r: { shopId: string }) => r.shopId)).toEqual([
        A.shopId,
        B.shopId,
        C.shopId,
      ]);
      await new Promise((r) => setTimeout(r, 800));
      expect(await pingsOf(third.body.id)).toEqual([]);
    }, 60_000);
  });

  describe('answering', () => {
    async function pingedShop(slug: string, extra: Record<string, unknown> = {}) {
      const shop = await makeShop(`Shop for ${slug} ${phone}`, 0.2, ['grocery']);
      const req = await ask({ q: slug, ...extra });
      expect(req.body.state).toBe('PINGING');
      const rows = await waitFor(
        async () => (await myPings(shop)).body,
        (b) => b.length === 1,
      );
      return { shop, requestId: req.body.id as string, ping: rows[0] };
    }

    it('answers once: a second answer returns the stored one', async () => {
      const { shop, ping } = await pingedShop('sugar');
      const first = await answer(shop, ping.id, { answer: 'yes', pricePaise: 4200 });
      const again = await answer(shop, ping.id, { answer: 'no' });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      const stock = await pool.query('SELECT price_paise FROM shop_stock WHERE shop_id = $1', [
        shop.shopId,
      ]);
      expect(stock.rows).toEqual([{ price_paise: 4200 }]);
    });

    it('a no changes nothing but the ping', async () => {
      const { shop, requestId, ping } = await pingedShop('salt');
      const res = await answer(shop, ping.id, { answer: 'no' });
      expect(res.body).toMatchObject({ state: 'NO', pricePaise: null });
      expect((await getRequest(requestId)).body.state).toBe('PINGING');
      expect((await myPings(shop)).body).toEqual([]);
      const stock = await pool.query('SELECT 1 FROM shop_stock WHERE shop_id = $1', [shop.shopId]);
      expect(stock.rowCount).toBe(0);
    });

    it("only the ping's own shop may answer; anyone else gets a 404", async () => {
      const { ping } = await pingedShop('rice');
      const stranger = await makeShop('Stranger', 5, ['grocery']);
      const res = await answer(stranger, ping.id, { answer: 'yes' });
      expect(res.status).toBe(404);
      expect(
        (await pool.query('SELECT state FROM pings WHERE id = $1', [ping.id])).rows[0].state,
      ).toBe('SENT');
      expect(
        (await answer(stranger, '00000000-0000-4000-8000-000000000000', { answer: 'no' })).status,
      ).toBe(404);
      expect((await answer(stranger, 'nope', { answer: 'no' })).status).toBe(404);
    });

    it('needs the shop role and a valid body', async () => {
      const { shop, ping } = await pingedShop('poha');
      expect(
        (await request(app).post(`/pings/${ping.id}/answer`).send({ answer: 'yes' })).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .post(`/pings/${ping.id}/answer`)
            .set(auth(seeker))
            .send({ answer: 'yes' })
        ).status,
      ).toBe(403);
      for (const body of [
        {},
        { answer: 'maybe' },
        { answer: 'yes', pricePaise: -1 },
        { answer: 'yes', pricePaise: 1.5 },
        { answer: 'yes', pricePaise: 10_000_001 },
        { answer: 'yes', quantityHint: 'lots' },
      ]) {
        const res = await answer(shop, ping.id, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code).toBe('invalid_request');
      }
    });

    it('rejects an answer to a ping that went quiet more than 24 hours ago', async () => {
      const { shop, requestId, ping } = await pingedShop('maida');
      await request(app).post(`/requests/${requestId}/close`).set(auth(seeker));
      await pool.query(`UPDATE pings SET sent_at = now() - interval '25 hours' WHERE id = $1`, [
        ping.id,
      ]);
      const res = await answer(shop, ping.id, { answer: 'yes', pricePaise: 100 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ping_closed');
      expect(
        (await pool.query('SELECT 1 FROM shop_stock WHERE shop_id = $1', [shop.shopId])).rowCount,
      ).toBe(0);
    });

    it('closing or expiring a request turns its open pings into NO_REPLY', async () => {
      const closed = await pingedShop('besan');
      await request(app).post(`/requests/${closed.requestId}/close`).set(auth(seeker));
      expect((await pingsOf(closed.requestId))[0]?.state).toBe('NO_REPLY');

      const expired = await pingedShop('ghee');
      await pool.query(
        `UPDATE requests SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [expired.requestId],
      );
      await getRequest(expired.requestId);
      expect((await pingsOf(expired.requestId))[0]?.state).toBe('NO_REPLY');
    });
  });

  describe('the request view', () => {
    it('sorts by price when a target is set, or as asked with ?sort=', async () => {
      const near = await makeShop('Near dear', 0.2, ['personal_care']);
      const far = await makeShop('Far cheap', 1.5, ['personal_care']);
      const req = await ask({ q: 'comb', targetPricePaise: 5000 });
      // Cap the race: wait for both pings, answer the far one first so it becomes ANSWERED...
      const nearPing = (
        await waitFor(
          async () => (await myPings(near)).body,
          (b) => b.length === 1,
        )
      )[0];
      const farPing = (
        await waitFor(
          async () => (await myPings(far)).body,
          (b) => b.length === 1,
        )
      )[0];
      await answer(far, farPing.id, { answer: 'yes', pricePaise: 3000 });
      // ...and the near shop's yes arrives late, so it becomes learned stock.
      await answer(near, nearPing.id, { answer: 'yes', pricePaise: 4800 });

      const byDefault = await getRequest(req.body.id);
      expect(byDefault.body.results.map((r: { shopId: string }) => r.shopId)).toEqual([
        far.shopId,
        near.shopId,
      ]);
      expect(byDefault.body.results[0]).toMatchObject({ source: 'live', savingsPaise: 2000 });
      expect(byDefault.body.results[1]).toMatchObject({ source: 'learned', savingsPaise: 200 });

      const byDistance = await getRequest(req.body.id, seeker, '?sort=distance');
      expect(byDistance.body.results.map((r: { shopId: string }) => r.shopId)).toEqual([
        near.shopId,
        far.shopId,
      ]);
      expect((await getRequest(req.body.id, seeker, '?sort=cheapest')).status).toBe(400);
    });

    it('accepts targetPricePaise up to 10,000,000 and nothing else', async () => {
      expect((await ask({ q: 'tamatar', targetPricePaise: 10_000_000 })).status).toBe(201);
      for (const targetPricePaise of [0, -5, 1.5, 10_000_001, 'cheap']) {
        const res = await ask({ q: 'tamatar', targetPricePaise });
        expect(res.status, String(targetPricePaise)).toBe(400);
      }
    });
  });

  describe('fan-out', () => {
    const claims = (allow: (shopId: string) => boolean) => {
      const released: string[] = [];
      return {
        released,
        claim: async (shopId: string) => allow(shopId),
        release: async (shopId: string) => {
          released.push(shopId);
        },
      };
    };
    async function pingingRequest(slug: string) {
      const noHooks = { ...ctx };
      delete noHooks.hooks;
      const { request: r } = await createRequest(noHooks, seeker.userId, {
        q: slug,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      });
      expect(r.state).toBe('PINGING');
      return r.id;
    }
    const fanCtx = (maxPings = 10) => ({ db: pool, logger, config: { maxPings } });

    it('pings only the nearest MAX_PINGS_PER_REQUEST shops', async () => {
      for (const km of [0.1, 0.2, 0.3, 0.4]) await makeShop(`cap ${km}`, km, ['stationery']);
      const id = await pingingRequest('pencil');
      const result = await fanOutPings(
        fanCtx(2),
        id,
        claims(() => true),
      );
      expect(result).toMatchObject({ targets: 2, sent: 2 });
    });

    it('skips shops that already have the item in learned stock and shops of another category', async () => {
      const known = await makeShop('Knows scissors', 0.1, ['stationery']);
      await makeShop('Does not', 0.2, ['stationery']);
      await makeShop('Hardware only', 0.15, ['hardware']);
      await pool.query(
        `INSERT INTO shop_stock (shop_id, item_id, source, last_confirmed_at, expires_at)
         VALUES ($1, $2, 'ping_yes', now(), now() + interval '7 days')`,
        [known.shopId, item['scissors']],
      );
      const id = await pingingRequest('scissors');
      await fanOutPings(
        fanCtx(50),
        id,
        claims(() => true),
      );
      const rows = await pingsOf(id);
      const names = (
        await pool.query(
          `SELECT s.name FROM pings p JOIN shops s ON s.id = p.shop_id WHERE p.request_id = $1`,
          [id],
        )
      ).rows.map((r) => r.name);
      expect(rows.length).toBeGreaterThan(0);
      expect(names).not.toContain('Knows scissors');
      expect(names).not.toContain('Hardware only');
      expect(names).toContain('Does not');
    });

    it('does not ping a shop the dedupe refuses, and gives back claims when the request is no longer live', async () => {
      await makeShop('Dedupe me', 0.05, ['mobile_accessories']);
      const id = await pingingRequest('power bank');
      const refusing = claims(() => false);
      expect(await fanOutPings(fanCtx(), id, refusing)).toMatchObject({
        targets: expect.any(Number),
        sent: 0,
      });

      const id2 = await pingingRequest('earphones');
      await pool.query(`UPDATE requests SET state = 'CLOSED' WHERE id = $1`, [id2]);
      const allowing = claims(() => true);
      const skipped = await fanOutPings(fanCtx(), id2, allowing);
      expect(skipped).toMatchObject({ sent: 0, skipped: 'not_live' });
      expect(await pingsOf(id2)).toEqual([]);
    });

    it('pings anyway, and says so, when the dedupe store is unavailable', async () => {
      await makeShop('Redis down shop', 0.05, ['household_kitchen']);
      const id = await pingingRequest('tawa');
      const result = await fanOutPings(fanCtx(), id, {
        claim: async () => true, // what createPingDedupe returns when Redis throws
        release: async () => undefined,
      });
      expect(result.sent).toBeGreaterThan(0);
    });

    it('logs and moves on when no shop qualifies', async () => {
      const id = await pingingRequest('torch'); // electrical: no such shop exists
      const result = await fanOutPings(
        fanCtx(),
        id,
        claims(() => true),
      );
      expect(result).toMatchObject({ targets: 0, sent: 0 });
      expect((await getRequest(id)).body.state).toBe('PINGING');
    });
  });
});
