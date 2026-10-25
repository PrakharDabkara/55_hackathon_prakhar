import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { fanOutPings, type PingClaims } from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });
const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };

// ADR-0028 and ADR-0029 through the HTTP API: a new item is asked about, a blocked one is not.
describe('open catalog over HTTP', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let provider: FakeProvider;
  let seeker: { token: string; userId: string };
  let phone = 9_870_000_000;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    provider = createFakeProvider();
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
    app = createApp({ config: testConfig(), logger, db: pool, ai });
    seeker = await loginAs(app, 'seeker', String(phone++));
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'requests, pings, new_item_attempts, query_cache');
    await pool.query(`DELETE FROM shops`);
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    provider.calls.length = 0;
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category: 'stationery' }
        : { itemId: null, needsClarification: false },
    );
  });

  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const ask = (q: string, user = seeker) =>
    request(app).post('/requests').set(auth(user)).send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
  const makeShop = async (name: string, km: number, categories: string[]) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO shops (name, phone, categories, location)
         VALUES ($1, '+910000000000', $4::text[],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING id`,
        [name, ORIGIN.lng, north(km), categories],
      )
    ).rows[0]?.id as string;

  it('a real unknown product opens a PINGING request for a new, unverified item', async () => {
    const res = await ask('foam glitter sheet');
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('PINGING');
    expect(res.body.item).toMatchObject({
      nameEn: 'Foam glitter sheet',
      category: 'stationery',
      unverified: true,
    });
  });

  it('asks stationery shops first, as plain text, and never sends the user or the shop to the model', async () => {
    const stationery = await Promise.all(
      [0.2, 0.4, 0.6].map((km, i) => makeShop(`Stationer ${i}`, km, ['stationery'])),
    );
    const hardware = await makeShop('Hardware', 0.1, ['hardware']);
    const res = await ask('foam glitter sheet');
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      res.body.id as string,
      claimsAll,
    );
    const asked = (
      await pool.query<{ shop_id: string }>(`SELECT shop_id FROM pings WHERE request_id = $1`, [
        res.body.id,
      ])
    ).rows.map((r) => r.shop_id);
    expect(asked.sort()).toEqual([...stationery].sort());
    expect(asked).not.toContain(hardware);
    const sent = JSON.stringify(provider.calls);
    for (const secret of [seeker.userId, 'Stationer', String(ORIGIN.lat)])
      expect(sent).not.toContain(secret);
  });

  it('falls back to the nearest shops of any category when too few match', async () => {
    const one = await makeShop('Only stationer', 0.5, ['stationery']);
    const near = await makeShop('Near kirana', 0.1, ['grocery']);
    const next = await makeShop('Next hardware', 0.2, ['hardware']);
    const far = await makeShop('Far dairy', 0.9, ['dairy']);
    const res = await ask('foam glitter sheet');
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      res.body.id as string,
      claimsAll,
    );
    const asked = (
      await pool.query<{ shop_id: string }>(`SELECT shop_id FROM pings WHERE request_id = $1`, [
        res.body.id,
      ])
    ).rows.map((r) => r.shop_id);
    expect(asked.sort()).toEqual([one, near, next].sort());
    expect(asked).not.toContain(far);
  });

  it('a deny-listed item is refused with 422 item_blocked and nothing is stored or sent', async () => {
    await makeShop('Kirana', 0.2, ['grocery']);
    const res = await ask('country made pistol');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('item_blocked');
    expect((await pool.query(`SELECT 1 FROM requests`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
    expect(provider.calls.filter((c) => c.kind === 'generate')).toHaveLength(0);
  });

  it('a model "blocked" verdict is refused the same way', async () => {
    provider.onGenerate(() => ({ verdict: 'blocked' }));
    const res = await ask('some harmful thing');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('item_blocked');
  });

  it('fails closed with 503 ai_busy when the classifier is down: nothing is sent', async () => {
    provider.onGenerate(() => {
      throw new Error('down');
    });
    const res = await ask('foam glitter sheet');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_busy');
    expect((await pool.query(`SELECT 1 FROM requests`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
  });

  it('nonsense stays 422 item_unresolved and creates nothing', async () => {
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'nonsense' }
        : { itemId: null, needsClarification: false },
    );
    const res = await ask('xyzzy plugh');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('item_unresolved');
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
  });

  it('the 11th new item of the day is refused with 429 new_item_limit', async () => {
    const words = [
      'qzorv',
      'xblin',
      'zumqo',
      'flqrn',
      'gribx',
      'snqrf',
      'pxlim',
      'dqrvn',
      'wxzel',
      'yqmbo',
    ];
    for (const word of words) expect((await ask(`${word} kit`)).status, word).toBe(201);
    const res = await ask('one more kit');
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: 'new_item_limit', scope: 'day' });
    const other = await loginAs(app, 'seeker', String(phone++));
    expect((await ask('one more kit', other)).status).toBe(201);
  });

  it('GET /search stays read-only: it never creates an item', async () => {
    const res = await request(app)
      .get('/search')
      .set(auth(seeker))
      .query({ q: 'foam glitter sheet', lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(res.status).toBe(200);
    expect(res.body.item).toBeNull();
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
  });

  it('GET /search refuses a create flag (unknown query field, ADR-0059): a GET never creates data', async () => {
    const res = await request(app)
      .get('/search')
      .set(auth(seeker))
      .query({ q: 'foam glitter sheet', lat: ORIGIN.lat, lng: ORIGIN.lng, create: 'true' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
  });

  it('POST /items/resolve opens the catalog (what resolve_item uses) and says the item is new', async () => {
    const post = (q: string, user: { token: string } | null = seeker) => {
      const r = request(app).post('/items/resolve');
      return (user ? r.set(auth(user)) : r).send({ q });
    };
    const res = await post('foam glitter sheet');
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ nameEn: 'Foam glitter sheet', unverified: true });
    expect(res.body.matchedBy).toBe('new_item');
    const again = await post('foam glitter sheet');
    expect(again.body.item.id).toBe(res.body.item.id);
    const blocked = await post('pistol');
    expect(blocked.status).toBe(200);
    expect(blocked.body.item).toBeNull();
    expect(blocked.body.refused).toEqual({ reason: 'blocked' });
    expect((await post('x', null)).status).toBe(401);
    expect((await post('')).status).toBe(400);
  });

  it('a shop saying yes verifies the item and teaches stock, so the next person gets Likely', async () => {
    const shopUser = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set(auth(shopUser))
      .send({ name: 'Stationer', lat: north(0.3), lng: ORIGIN.lng, categories: ['stationery'] });
    expect(made.status).toBe(201);
    const created = await ask('foam glitter sheet');
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      created.body.id as string,
      claimsAll,
    );
    const pings = await request(app).get('/shops/me/pings').set(auth(shopUser));
    expect(pings.body).toHaveLength(1);
    expect(pings.body[0].item.nameEn).toBe('Foam glitter sheet');
    const yes = await request(app)
      .post(`/pings/${pings.body[0].id}/answer`)
      .set(auth(shopUser))
      .send({ answer: 'yes', pricePaise: 2500 });
    expect(yes.status).toBe(200);
    const { rows } = await pool.query(`SELECT unverified FROM items WHERE source = 'user'`);
    expect(rows).toEqual([{ unverified: false }]);
    const next = await loginAs(app, 'seeker', String(phone++));
    const again = await ask('foam glitter sheet', next);
    expect(again.body.item.unverified).toBe(false);
    expect(again.body.results).toEqual([
      expect.objectContaining({ shopId: made.body.id, source: 'learned', pricePaise: 2500 }),
    ]);
  });
});

describe('shop categories', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let phone = 9_880_000_000;
  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    app = createApp({ config: testConfig(), logger, db: pool });
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  const create = async (body: Record<string, unknown>) => {
    const u = await loginAs(app, 'shop', String(phone++));
    return request(app)
      .post('/shops')
      .set({ Authorization: `Bearer ${u.token}` })
      .send({ name: 'Shop', lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
  };

  it('accepts the five new categories and up to three per shop', async () => {
    const res = await create({ categories: ['pooja', 'stationery', 'bakery_sweets'] });
    expect(res.status).toBe(201);
    expect(res.body.categories).toEqual(['pooja', 'stationery', 'bakery_sweets']);
    for (const c of ['dairy', 'sabzi_fruit', 'medical'])
      expect((await create({ categories: [c] })).status, c).toBe(201);
  });

  it('refuses four categories, repeats and unknown names', async () => {
    expect((await create({ categories: ['pooja', 'dairy', 'medical', 'hardware'] })).status).toBe(
      400,
    );
    expect((await create({ categories: ['pooja', 'pooja'] })).status).toBe(400);
    expect((await create({ categories: ['pharmacy'] })).status).toBe(400);
  });

  it('a shop that picks none becomes a kirana (grocery)', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(res.body.categories).toEqual(['grocery']);
  });
});
