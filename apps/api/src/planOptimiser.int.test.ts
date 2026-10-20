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
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });
const call = (name: string, args: Record<string, unknown>) => ({ name, args });

/** Day 14a: the plan the user gets is computed in code from every offer the errand has seen. */
describe('errand plans: two plans from the optimiser (fake model, real database)', () => {
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
        `INSERT INTO users (phone, role) VALUES ('+919822400101', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  beforeEach(async () => {
    await truncateKeepingShops(pool, 'errands, requests, ai_calls');
    await pool.query('DELETE FROM shop_stock');
    await pool.query(`DELETE FROM shops WHERE name LIKE 'P14 %'`);
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
        [`P14 ${name}`, ORIGIN.lng, north(km)],
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
  /** A yes to one of the errand's own requests ("confirmed"). */
  async function confirm(errandId: string, shopId: string, slug: string, pricePaise: number) {
    const found = await pool.query<{ request_id: string }>(
      `SELECT request_id FROM errand_requests WHERE errand_id = $1 AND item_id = $2`,
      [errandId, ids[slug]],
    );
    let requestId = found.rows[0]?.request_id;
    if (!requestId) {
      requestId = (
        await pool.query<{ id: string }>(
          `INSERT INTO requests (user_id, item_id, raw_query, location, radius_m, state, expires_at)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 2000,
                   'PINGING', now() + interval '10 minutes') RETURNING id`,
          [userId, ids[slug], slug, ORIGIN.lng, ORIGIN.lat],
        )
      ).rows[0]?.id as string;
      await pool.query(
        `INSERT INTO errand_requests (errand_id, request_id, item_id) VALUES ($1, $2, $3)`,
        [errandId, requestId, ids[slug]],
      );
    }
    await pool.query(
      `INSERT INTO pings (request_id, shop_id, item_id, state, price_paise, sent_at, answered_at)
       VALUES ($1, $2, $3, 'YES', $4, now(), now())`,
      [requestId, shopId, ids[slug], pricePaise],
    );
  }

  const newErrand = (task: string) =>
    createErrand({ db: pool, logger, limits }, userId, {
      task,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      requestId: 'req-p14',
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

  async function threeItemsTwoWays() {
    // Mishra has all three but is dearer; Gupta and Sharma are cheaper for some.
    const mishra = await shop('Mishra', 0.3);
    const gupta = await shop('Gupta', 0.6);
    const sharma = await shop('Sharma', 0.9);
    await stock(mishra, 'tea-leaves', 14000);
    await stock(mishra, 'sugar', 5000);
    await stock(mishra, 'milk', 3000);
    await stock(gupta, 'tea-leaves', 12000);
    await stock(gupta, 'sugar', 4500);
    await stock(sharma, 'milk', 2800);
    return { mishra, gupta, sharma };
  }
  const chaiWords: [string, string][] = [
    ['chai patti', 'tea-leaves'],
    ['chini', 'sugar'],
    ['doodh', 'milk'],
  ];
  const chaiClaims = () => [
    claim('chai patti', 'tea-leaves'),
    claim('chini', 'sugar'),
    claim('doodh', 'milk'),
  ];

  it('stores sasta and kam_dukaan side by side with the recommendation, in errands.plan', async () => {
    const { mishra, gupta, sharma } = await threeItemsTwoWays();
    const { id } = await newErrand('chai banane ka saaman: chai patti, chini, doodh');
    play(chaiWords, chaiClaims());
    expect((await runErrand(deps(), id)).outcome).toBe('plan_ready');

    const { plan } = await view(id);
    const sasta = plan['plans'].sasta;
    const kam = plan['plans'].kam_dukaan;
    expect(sasta.items.map((i: { shopId: string }) => i.shopId)).toEqual([gupta, gupta, sharma]);
    expect(sasta.totalPricePaise).toBe(12000 + 4500 + 2800);
    expect(sasta.shopCount).toBe(2);
    expect(kam.items.every((i: { shopId: string }) => i.shopId === mishra)).toBe(true);
    expect(kam.totalPricePaise).toBe(14000 + 5000 + 3000);
    expect(kam.shopCount).toBe(1);
    expect(kam.route.orderedStops).toHaveLength(1);
    expect(sasta.route.orderedStops).toHaveLength(2);
    expect(kam.totalDistanceM).toBe(kam.route.totalM);
    // 2,700 paise dearer for one shop fewer: inside the default limit of 3,000 paise.
    expect(plan['recommended']).toBe('kam_dukaan');
    expect(plan['recommendation']).toMatchObject({ extraPaise: 2700, stopsSaved: 1 });
    // The top level mirrors the recommended plan, so older readers still work.
    expect(plan['items']).toEqual(kam.items);
    expect(plan['totalPricePaise']).toBe(kam.totalPricePaise);
  });

  it('recommends sasta when one shop fewer costs more than the limit and 10 %', async () => {
    await threeItemsTwoWays();
    const { id } = await newErrand('chai banane ka saaman');
    play(chaiWords, chaiClaims());
    await runErrand(deps({ fewerStopsMaxExtraPaise: 100 }), id);
    const { plan } = await view(id);
    // Extra 2,700 on 19,300 is 14 %: over 10 %, over 100 paise.
    expect(plan['recommended']).toBe('sasta');
    expect(plan['items']).toEqual(plan['plans'].sasta.items);
  });

  it('ignores the shops the model named: the optimiser picks, from real offers only', async () => {
    const { mishra } = await threeItemsTwoWays();
    const { id } = await newErrand('chai');
    play(chaiWords, [
      claim('chai patti', 'tea-leaves', mishra),
      claim('chini', 'sugar', mishra),
      claim('doodh', 'milk', mishra),
    ]);
    await runErrand(deps(), id);
    const { plan } = await view(id);
    expect(plan['plans'].sasta.totalPricePaise).toBe(19300);
  });

  it('prefers a confirmed answer over a cheaper likely one', async () => {
    await threeItemsTwoWays();
    const near = await shop('Confirmed Dear', 0.4);
    const { id } = await newErrand('chini');
    // Learned stock says ₹45 at Gupta; a shop that answered this errand says ₹52.
    await confirm(id, near, 'sugar', 5200);
    play([['chini', 'sugar']], [claim('chini', 'sugar')]);
    await runErrand(deps(), id);
    const { plan } = await view(id);
    expect(plan['plans'].sasta.items[0]).toMatchObject({
      shopId: near,
      status: 'confirmed',
      pricePaise: 5200,
    });
    expect(plan['plans'].sasta.items[0].freshness).toMatch(/Confirmed/);
  });

  it('uses likely offers for an item with no confirmed answer', async () => {
    const { gupta } = await threeItemsTwoWays();
    const near = await shop('Confirmed Tea', 0.4);
    const { id } = await newErrand('chai, chini');
    await confirm(id, near, 'tea-leaves', 15000);
    play(
      [
        ['chai patti', 'tea-leaves'],
        ['chini', 'sugar'],
      ],
      [claim('chai patti', 'tea-leaves'), claim('chini', 'sugar')],
    );
    await runErrand(deps(), id);
    const { plan } = await view(id);
    const items = plan['plans'].sasta.items;
    expect(items[0]).toMatchObject({ shopId: near, status: 'confirmed' });
    expect(items[1]).toMatchObject({ shopId: gupta, status: 'likely', pricePaise: 4500 });
  });

  it('shows the catalog item that was confirmed next to the words the customer used', async () => {
    const shopId = await shop('Candles', 0.3);
    await stock(shopId, 'candle', 1500);
    const { id } = await newErrand('diya chahiye');
    play([['diya', 'candle']], [claim('diya', 'candle', shopId)]);
    await runErrand(deps(), id);
    const { plan, progress } = await view(id);
    expect(plan['items'][0]).toMatchObject({
      text: 'diya',
      itemName: 'candle',
      matchedAs: true,
    });
    expect(progress).toContain("You said 'diya': the shop has 'candle'");
  });

  it('does not mark matchedAs when the words are the item or a synonym of it', async () => {
    const shopId = await shop('Tea', 0.3);
    await stock(shopId, 'tea-leaves', 13000);
    const { id } = await newErrand('chai patti');
    play([['chai patti', 'tea-leaves']], [claim('chai patti', 'tea-leaves')]);
    await runErrand(deps(), id);
    const { plan, progress } = await view(id);
    expect(plan['items'][0]).toMatchObject({
      text: 'chai patti',
      itemName: 'tea leaves',
      matchedAs: false,
    });
    expect(progress.join('\n')).not.toMatch(/kaha tha/);
  });

  it('counts every item in "Samjha", including one that could not be resolved', async () => {
    const shopId = await shop('Tea', 0.3);
    await stock(shopId, 'tea-leaves', 13000);
    const { id } = await newErrand('chai patti aur kuch');
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chai patti' }),
          call('resolve_item', { text: 'qwertyuiop zxcv' }),
        ],
      },
      { toolCalls: [call('find_item_nearby', { itemId: ids['tea-leaves'] })] },
      {
        toolCalls: [
          call('submit_plan', {
            items: [
              claim('chai patti', 'tea-leaves'),
              { text: 'qwertyuiop zxcv', status: 'not_found' },
            ],
          }),
        ],
      },
    ]);
    await runErrand(deps(), id);
    const { progress } = await view(id);
    expect(progress[0]).toBe('Understood: 2 items');
  });

  it('puts answers that arrive after the plan under lateAnswers, not in the timeline', async () => {
    const { mishra } = await threeItemsTwoWays();
    const { id } = await newErrand('chini');
    await confirm(id, mishra, 'sugar', 5000);
    play([['chini', 'sugar']], [claim('chini', 'sugar')]);
    await runErrand(deps(), id);
    const before = await view(id);
    expect(before.progress.join('\n')).toContain('has it ₹50');
    expect(before.lateAnswers).toEqual([]);

    const late = await shop('Late Shop', 0.5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await confirm(id, late, 'sugar', 4100);
    const after = await view(id);
    expect(after.progress.join('\n')).not.toContain('Late Shop');
    expect(after.progress.join('\n')).toContain('has it ₹50');
    expect(after.lateAnswers).toEqual(['P14 Late Shop has it ₹41']);
  });
});
