import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { fanOutPings } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { insertShopWithStock, north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });
const claims = { claim: async () => true, release: async () => undefined };

/**
 * PR app round 2: "shops asked" is reported by the server (C-07), "Ask shops now" (C-05), a picked
 * item stays the request's item (C-11), and a customer has at most 3 active searches (C-08/C-10).
 */
describe('searches: asking, ask-now, picked items and the limit of 3', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let seeker: { token: string; userId: string };
  let other: { token: string; userId: string };
  let phone = 9_830_000_000;
  const item: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    for (const r of (await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items'))
      .rows)
      item[r.slug] = r.id;
    app = createApp({ config: testConfig(), logger, db: pool });
    other = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM shopping_lists');
    await pool.query('DELETE FROM requests');
    await pool.query('DELETE FROM shops');
    await pool.query('DELETE FROM shop_stock');
    seeker = await loginAs(app, 'seeker', String(phone++));
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const ask = (body: Record<string, unknown>, user = seeker) =>
    request(app)
      .post('/requests')
      .set(auth(user))
      .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  const view = (id: string, user = seeker) => request(app).get(`/requests/${id}`).set(auth(user));
  const fanOut = (id: string) =>
    fanOutPings({ db: pool, logger, config: { maxPings: 10 } }, id, claims);
  async function shop(name: string, km: number) {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(owner))
      .send({ name, lat: north(km), lng: ORIGIN.lng, categories: ['grocery'] });
    expect(made.status).toBe(201);
    return made.body.id as string;
  }

  describe('asking (C-07)', () => {
    it('is true until the fan-out has run, then false, with shops or without', async () => {
      await shop('Near', 0.3);
      const a = await ask({ itemId: item['sugar'] });
      expect(a.body.state).toBe('PINGING');
      expect(a.body.asking).toBe(true);
      await fanOut(a.body.id);
      const after = await view(a.body.id);
      expect(after.body.asking).toBe(false);
      expect(after.body.pingStats.sent).toBe(1);

      await pool.query('DELETE FROM shops');
      const b = await ask({ itemId: item['sugar'] });
      expect(b.body.asking).toBe(true);
      await fanOut(b.body.id);
      const none = await view(b.body.id);
      expect(none.body.asking).toBe(false);
      expect(none.body.pingStats.sent).toBe(0);
    });

    it('is false for a request answered from remembered stock (nobody is being asked)', async () => {
      for (const [i, km] of [0.2, 0.4, 0.6].entries())
        await insertShopWithStock(pool, {
          name: `S${i}`,
          km,
          itemId: item['sugar'] as string,
          ageHours: 2,
        });
      const res = await ask({ itemId: item['sugar'] });
      expect(res.body.state).toBe('ANSWERED');
      expect(res.body.asking).toBe(false);
    });

    it('a finished fan-out is not queued again by the sweeper', async () => {
      const a = await ask({ itemId: item['sugar'] });
      await fanOut(a.body.id);
      await pool.query(`UPDATE requests SET created_at = now() - interval '5 minutes'`);
      const { findUnpingedRequestIds } = await import('./modules/requests/index.js');
      expect(await findUnpingedRequestIds(pool)).toEqual([]);
    });
  });

  describe('ask shops now (C-05)', () => {
    async function remembered() {
      const ids: string[] = [];
      for (const [i, km] of [0.2, 0.4, 0.6].entries())
        ids.push(
          await insertShopWithStock(pool, {
            name: `S${i}`,
            km,
            itemId: item['sugar'] as string,
            ageHours: 2,
          }),
        );
      return ids;
    }

    it('turns an answered-from-memory request into a live ask of the very shops that remembered', async () => {
      const ids = await remembered();
      const a = await ask({ itemId: item['sugar'] });
      expect(a.body.state).toBe('ANSWERED');
      expect(a.body.pingStats.sent).toBe(0);

      const res = await request(app).post(`/requests/${a.body.id}/ask`).set(auth(seeker));
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('PINGING');
      expect(res.body.asking).toBe(true);
      await fanOut(a.body.id);
      const after = await view(a.body.id);
      expect(after.body.pingStats.sent).toBe(3);
      const pinged = (
        await pool.query(`SELECT shop_id FROM pings WHERE request_id = $1`, [a.body.id])
      ).rows.map((r) => r.shop_id);
      expect(pinged.sort()).toEqual([...ids].sort());
    });

    it('gives the ask a fresh deadline', async () => {
      await remembered();
      const a = await ask({ itemId: item['sugar'] });
      await pool.query(`UPDATE requests SET expires_at = now() + interval '1 minute'`);
      const res = await request(app).post(`/requests/${a.body.id}/ask`).set(auth(seeker));
      const left = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(left).toBeGreaterThan(10 * 60_000);
    });

    it('asked twice is the same ask; nobody else may ask for you; a request that already has pings cannot', async () => {
      await remembered();
      const a = await ask({ itemId: item['sugar'] });
      const first = await request(app).post(`/requests/${a.body.id}/ask`).set(auth(seeker));
      const again = await request(app).post(`/requests/${a.body.id}/ask`).set(auth(seeker));
      expect(first.status).toBe(200);
      expect(again.status).toBe(200);
      expect(again.body.state).toBe('PINGING');
      expect((await request(app).post(`/requests/${a.body.id}/ask`).set(auth(other))).status).toBe(
        404,
      );

      await pool.query('DELETE FROM shops');
      await pool.query('DELETE FROM shop_stock');
      const b = await ask({ itemId: item['ghee'] });
      await shop('Near', 0.3);
      await fanOut(b.body.id);
      await pool.query(`UPDATE pings SET state = 'YES', price_paise = 500, answered_at = now()`);
      await pool.query(`UPDATE requests SET state = 'ANSWERED' WHERE id = $1`, [b.body.id]);
      const refused = await request(app).post(`/requests/${b.body.id}/ask`).set(auth(seeker));
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('already_asked');
    });
  });

  describe('a picked item (C-11a)', () => {
    it('is flagged picked; typed words are not', async () => {
      const picked = await ask({ q: 'chini', itemId: item['sugar'], understanding: 'changed' });
      expect(picked.body.picked).toBe(true);
      expect(picked.body.typed).toBe('chini');
      const typed = await ask({ q: 'sugar' });
      expect(typed.status).toBe(201);
      expect(typed.body.picked).toBe(false);
    });
  });

  describe('three active searches at most (C-08, C-10)', () => {
    const three = async () => {
      const ids: string[] = [];
      for (const slug of ['sugar', 'ghee', 'milk']) {
        const r = await ask({ itemId: item[slug] });
        expect(r.status, slug).toBe(201);
        ids.push(r.body.id);
      }
      return ids;
    };

    it('a 4th is refused with search_limit and nothing is created or sent', async () => {
      await shop('Near', 0.3);
      await three();
      const fourth = await ask({ itemId: item['curd'] });
      expect(fourth.status).toBe(409);
      expect(fourth.body.error.code).toBe('search_limit');
      expect(fourth.body.error.limit).toBe(3);
      expect((await pool.query(`SELECT 1 FROM requests`)).rowCount).toBe(3);
    });

    it('stopping one frees the place and withdraws its pings from the shops', async () => {
      await shop('Near', 0.3);
      const ids = await three();
      await fanOut(ids[0] as string);
      expect(
        (await pool.query(`SELECT 1 FROM pings WHERE request_id = $1 AND state = 'SENT'`, [ids[0]]))
          .rowCount,
      ).toBe(1);
      expect((await request(app).post(`/requests/${ids[0]}/close`).set(auth(seeker))).status).toBe(
        200,
      );
      expect(
        (await pool.query(`SELECT 1 FROM pings WHERE request_id = $1 AND state = 'SENT'`, [ids[0]]))
          .rowCount,
      ).toBe(0);
      expect((await ask({ itemId: item['salt'] })).status).toBe(201);
    });

    it('is per customer, expired and closed searches do not count, and a replayed key is not a new search', async () => {
      const ids = await three();
      expect((await ask({ itemId: item['sugar'] }, other)).status).toBe(201);
      await pool.query(
        `UPDATE requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [ids[1]],
      );
      expect((await ask({ itemId: item['salt'] })).status).toBe(201);
      const keyed = await request(app)
        .post('/requests')
        .set({ ...auth(other), 'Idempotency-Key': 'k-1' })
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, itemId: item['ghee'] });
      const again = await request(app)
        .post('/requests')
        .set({ ...auth(other), 'Idempotency-Key': 'k-1' })
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, itemId: item['ghee'] });
      expect(keyed.body.id).toBe(again.body.id);
    });

    it('a sent list counts as one; sending a list as the 4th is refused too', async () => {
      await shop('Near', 0.3);
      await ask({ itemId: item['sugar'] });
      await ask({ itemId: item['ghee'] });
      const sendList = async () => {
        const sorted = await request(app)
          .post('/lists/sort')
          .set(auth(seeker))
          .send({ lines: ['sugar', 'ghee'] });
        return request(app)
          .post(`/lists/${sorted.body.id}/send`)
          .set(auth(seeker))
          .send({ lat: ORIGIN.lat, lng: ORIGIN.lng });
      };
      const first = await sendList();
      expect(first.status).toBe(200);
      expect(first.body.state).toBe('OPEN');
      expect((await ask({ itemId: item['salt'] })).body.error.code).toBe('search_limit');
      const second = await sendList();
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('search_limit');
    });

    it('GET /searches/active lists the live searches, newest first, with their reply counts', async () => {
      await shop('Near', 0.3);
      const ids = await three();
      await fanOut(ids[0] as string);
      await pool.query(`UPDATE pings SET state = 'YES', price_paise = 500, answered_at = now()`);
      await pool.query(`UPDATE requests SET state = 'ANSWERED' WHERE id = $1`, [ids[0]]);
      await request(app).post(`/requests/${ids[2]}/close`).set(auth(seeker));
      const res = await request(app).get('/searches/active').set(auth(seeker));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(3);
      expect(res.body.searches.map((s: { id: string }) => s.id)).toEqual([ids[1], ids[0]]);
      expect(res.body.searches[1]).toMatchObject({ kind: 'request', replies: 1 });
      expect(res.body.searches[1].item).toMatchObject({ nameEn: expect.any(String) });
      expect((await request(app).get('/searches/active').set(auth(other))).body.searches).toEqual(
        [],
      );
    });
  });
});
