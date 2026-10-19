import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import {
  createErrand,
  getErrand,
  limitsFromConfig,
  runErrand,
  type ErrandLimits,
} from './modules/errands/index.js';
import { testConfig } from './testing/config.js';
import { north, ORIGIN } from './testing/fixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });
const call = (name: string, args: Record<string, unknown>) => ({ name, args });

/** Day 17, PR H: pickup reports reach the errand plan (ADR-0036). */
describe('errand plans honour what customers reported at the shop (Le liya?, ADR-0035)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let userId: string;
  let ids: Record<string, string> = {};
  let provider: FakeProvider;
  const config = testConfig();
  const limits: ErrandLimits = { ...limitsFromConfig(config), userHourlyLimit: 10_000 };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    ids = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
    userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ('+919822400202', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE errands, requests, ai_calls CASCADE');
    await pool.query('DELETE FROM shop_stock');
    await pool.query(`DELETE FROM shops WHERE name LIKE 'P17 %'`);
    provider = createFakeProvider();
  });

  const ai = () =>
    createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1 },
    });
  const deps = (extra: Partial<ErrandLimits> = {}) => ({
    db: pool,
    logger,
    ai: ai(),
    limits: { ...limits, ...extra },
    trigramThreshold: 0.4,
  });

  async function shop(name: string, km: number): Promise<string> {
    return (
      await pool.query<{ id: string }>(
        `INSERT INTO shops (name, phone, categories, location)
         VALUES ($1, '+910000000000', ARRAY['grocery'],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING id`,
        [`P17 ${name}`, ORIGIN.lng, north(km)],
      )
    ).rows[0]?.id as string;
  }
  /** Learned stock ("likely"): the shop said yes to the item some hours ago. */
  const stock = (shopId: string, slug: string, pricePaise: number, ageHours = 2) =>
    pool.query(
      `INSERT INTO shop_stock (shop_id, item_id, source, price_paise, last_confirmed_at, expires_at)
       VALUES ($1, $2, 'ping_yes', $4, now() - make_interval(hours => $3::int),
               now() - make_interval(hours => $3::int) + interval '7 days')`,
      [shopId, ids[slug], ageHours, pricePaise],
    );
  const newErrand = (task: string) =>
    createErrand({ db: pool, logger, limits }, userId, {
      task,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      requestId: 'req-p17',
    });
  const view = async (id: string) =>
    (await getErrand(
      { db: pool, logger, events: undefined, requests: undefined } as never,
      userId,
      id,
    )) as {
      plan: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      progress: string[];
      lateAnswers: string[];
      state: string;
    };
  const claim = (text: string, slug: string, shopId?: string, status = 'likely') => ({
    text,
    itemId: ids[slug],
    status,
    ...(shopId && { shopId }),
  });
  /** The model resolves each word, then hands in claims: the server decides what they are worth. */
  function play(words: [string, string][], items: unknown[]) {
    provider.playChat([
      { toolCalls: words.map(([text]) => call('resolve_item', { text })) },
      {
        toolCalls: words.map(([, slug]) => call('find_item_nearby', { itemId: ids[slug] })),
      },
      { toolCalls: [call('submit_plan', { items })] },
    ]);
  }

  /** The customer's report on a shop's learned answer. */
  const report = (shopId: string, slug: string, over: string) =>
    pool.query(`UPDATE shop_stock SET ${over} WHERE shop_id = $1 AND item_id = $2`, [
      shopId,
      ids[slug],
    ]);
  const sugarPlan = async (claimedShop?: string) => {
    const { id } = await newErrand('chini');
    play([['chini', 'sugar']], [claim('chini', 'sugar', claimedShop)]);
    expect((await runErrand(deps(), id)).outcome).toBe('plan_ready');
    return (await view(id)).plan;
  };

  it('leaves out an answer a customer called wrong ("Wahan nahi tha")', async () => {
    const wrong = await shop('Wrong', 0.3);
    const right = await shop('Right', 0.6);
    await stock(wrong, 'sugar', 4000);
    await stock(right, 'sugar', 5000);
    await report(wrong, 'sugar', `expires_at = now(), wrong_reports = 1`);
    const plan = await sugarPlan(wrong);
    expect(plan['plans'].sasta.items[0]).toMatchObject({ shopId: right, status: 'likely' });
    expect(plan['plans'].kam_dukaan.items[0]).toMatchObject({ shopId: right });
  });

  it('puts a shop with repeated wrong reports last for that item, even when it is cheapest and nearest', async () => {
    const doubtful = await shop('Doubtful', 0.3);
    const clean = await shop('Clean', 0.9);
    await stock(doubtful, 'sugar', 4000);
    await stock(clean, 'sugar', 5200);
    await report(doubtful, 'sugar', `wrong_reports = 2`);
    const plan = await sugarPlan(doubtful);
    expect(plan['plans'].sasta.items[0]).toMatchObject({ shopId: clean, pricePaise: 5200 });
    expect(plan['plans'].kam_dukaan.items[0]).toMatchObject({ shopId: clean });
  });

  it('still uses a doubtful shop when nobody else has the item', async () => {
    const doubtful = await shop('Only one', 0.3);
    await stock(doubtful, 'sugar', 4000);
    await report(doubtful, 'sugar', `wrong_reports = 3`);
    const plan = await sugarPlan(doubtful);
    expect(plan['items'][0]).toMatchObject({ shopId: doubtful, status: 'likely' });
  });

  it('does not rank the shop down for its other items', async () => {
    const mixed = await shop('Mixed', 0.3);
    const other = await shop('Other', 0.9);
    await stock(mixed, 'sugar', 4000);
    await stock(mixed, 'milk', 3000);
    await stock(other, 'milk', 3500);
    await report(mixed, 'sugar', `wrong_reports = 2`);
    const { id } = await newErrand('doodh');
    play([['doodh', 'milk']], [claim('doodh', 'milk', mixed)]);
    await runErrand(deps(), id);
    expect((await view(id)).plan['items'][0]).toMatchObject({ shopId: mixed });
  });

  it('marks the plan card "Grahak ne confirm kiya" when a customer confirmed that shop', async () => {
    const verified = await shop('Verified', 0.3);
    await stock(verified, 'sugar', 4000);
    await report(verified, 'sugar', `customer_verified_at = now()`);
    const plan = await sugarPlan(verified);
    expect(plan['items'][0]).toMatchObject({ shopId: verified, customerVerified: true });
    expect(plan['plans'].sasta.items[0].customerVerified).toBe(true);
  });

  it('does not mark a shop nobody confirmed, nor a live yes of this errand', async () => {
    const plain = await shop('Plain', 0.3);
    await stock(plain, 'sugar', 4000);
    const plan = await sugarPlan(plain);
    expect(plan['items'][0].customerVerified).not.toBe(true);
  });
});
