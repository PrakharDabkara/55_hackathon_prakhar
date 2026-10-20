import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import {
  catchUpShop,
  fanOutPings,
  MISC_FANOUT_MAX,
  type PingClaims,
} from './modules/requests/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });
const claimsAll: PingClaims = { claim: async () => true, release: async () => undefined };
const deps = { db: undefined as unknown as Pool, logger, config: { maxPings: 10 } };

// ADR-0046: an item nobody could file under a kind of shop goes to the nearest open shops of any
// kind, at most MISC_FANOUT_MAX of them.
describe('misc requests: uncategorised items', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let provider: FakeProvider;
  let seeker: { token: string; userId: string };
  let phone = 9_850_000_000;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    deps.db = pool;
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
    setCategory('other');
  });

  const setCategory = (category: string) =>
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category }
        : { itemId: null, needsClarification: false },
    );
  const ask = (q: string) =>
    request(app)
      .post('/requests')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({ q, lat: ORIGIN.lat, lng: ORIGIN.lng });
  const makeShop = async (name: string, km: number, categories: string[], closed = false) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO shops (name, phone, categories, location, closed_until)
         VALUES ($1, '+910000000000', $4::text[],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                 CASE WHEN $5 THEN now() + interval '5 hours' END) RETURNING id`,
        [name, ORIGIN.lng, north(km), categories, closed],
      )
    ).rows[0]?.id as string;
  const pinged = async (requestId: string) =>
    (
      await pool.query<{ shop_id: string }>(`SELECT shop_id FROM pings WHERE request_id = $1`, [
        requestId,
      ])
    ).rows.map((r) => r.shop_id);

  it('names the cap in one place: MISC_FANOUT_MAX is 15', () => {
    expect(MISC_FANOUT_MAX).toBe(15);
  });

  it('marks the request misc and the item uncategorised when the classifier says "other"', async () => {
    const res = await ask('antique brass doorknob');
    expect(res.status).toBe(201);
    const row = (
      await pool.query<{ misc: boolean; uncategorised: boolean; category: string }>(
        `SELECT r.misc, i.uncategorised, i.category FROM requests r JOIN items i ON i.id = r.item_id
          WHERE r.id = $1`,
        [res.body.id],
      )
    ).rows[0];
    expect(row).toEqual({ misc: true, uncategorised: true, category: 'general_store' });
  });

  it('a categorised new item is not misc', async () => {
    setCategory('stationery');
    const res = await ask('foam glitter sheet');
    const row = (
      await pool.query<{ misc: boolean }>(`SELECT misc FROM requests WHERE id = $1`, [res.body.id])
    ).rows[0];
    expect(row?.misc).toBe(false);
  });

  it('asks the nearest 15 open shops of any kind, and never a closed one', async () => {
    const open: string[] = [];
    for (let i = 0; i < 20; i++)
      open.push(await makeShop(`Shop ${i}`, 0.05 + i * 0.05, [i % 2 ? 'hardware' : 'dairy']));
    const closed = await makeShop('Closed near', 0.01, ['grocery'], true);
    const res = await ask('antique brass doorknob');
    await fanOutPings({ ...deps }, res.body.id as string, claimsAll);
    const asked = await pinged(res.body.id as string);
    expect(asked).toHaveLength(MISC_FANOUT_MAX);
    expect(asked).not.toContain(closed);
    expect(asked.sort()).toEqual(open.slice(0, MISC_FANOUT_MAX).sort());
  });

  it("keeps today's behaviour for a categorised item: only shops of the kind, up to the normal cap", async () => {
    setCategory('stationery');
    const stationers: string[] = [];
    for (let i = 0; i < 12; i++)
      stationers.push(await makeShop(`Stat ${i}`, 0.1 + i * 0.05, ['stationery']));
    await makeShop('Hardware', 0.05, ['hardware']);
    const res = await ask('foam glitter sheet');
    await fanOutPings({ ...deps }, res.body.id as string, claimsAll);
    const asked = await pinged(res.body.id as string);
    expect(asked).toHaveLength(10);
    expect(asked.every((id) => stationers.includes(id))).toBe(true);
  });

  it('catch-up pings a shop of any kind that opens later, until the cap of 15 is reached', async () => {
    for (let i = 0; i < 10; i++) await makeShop(`Early ${i}`, 0.05 + i * 0.05, ['dairy']);
    const res = await ask('antique brass doorknob');
    await fanOutPings({ ...deps }, res.body.id as string, claimsAll);
    expect(await pinged(res.body.id as string)).toHaveLength(10);

    const later = await makeShop('Later hardware', 0.6, ['hardware']);
    expect((await catchUpShop({ ...deps }, later, claimsAll)).sent).toBe(1);
    expect(await pinged(res.body.id as string)).toHaveLength(11);

    // Four more fill it to the cap; the next one is not asked.
    for (let i = 0; i < 4; i++) {
      const id = await makeShop(`Fill ${i}`, 0.7 + i * 0.01, ['bakery_sweets']);
      await catchUpShop({ ...deps }, id, claimsAll);
    }
    expect(await pinged(res.body.id as string)).toHaveLength(MISC_FANOUT_MAX);
    const over = await makeShop('Over the cap', 0.9, ['dairy']);
    expect((await catchUpShop({ ...deps }, over, claimsAll)).sent).toBe(0);
  });

  it('catch-up still needs a matching kind for a categorised request', async () => {
    setCategory('stationery');
    await makeShop('Stationer', 0.1, ['stationery']);
    const res = await ask('foam glitter sheet');
    await fanOutPings({ ...deps }, res.body.id as string, claimsAll);
    const dairy = await makeShop('Dairy later', 0.2, ['dairy']);
    expect((await catchUpShop({ ...deps }, dairy, claimsAll)).sent).toBe(0);
  });

  it('shows the shop "may not be your usual stock" on the ping, and only for a misc request', async () => {
    const owner = await loginAs(app, 'shop', String(phone++));
    const made = await request(app)
      .post('/shops')
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ name: 'Misc Kirana', lat: north(0.3), lng: ORIGIN.lng, categories: ['grocery'] });
    expect(made.status).toBe(201);
    const res = await ask('antique brass doorknob');
    await fanOutPings({ ...deps }, res.body.id as string, claimsAll);
    const pings = (
      await request(app)
        .get('/shops/me/pings')
        .set({ Authorization: `Bearer ${owner.token}` })
    ).body;
    expect(pings).toHaveLength(1);
    expect(pings[0].misc).toBe(true);
  });
});
