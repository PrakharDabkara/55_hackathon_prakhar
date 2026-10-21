import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAi,
  createFakeProvider,
  type AiContext,
  type FakeProvider,
} from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import {
  answerErrand,
  createErrand,
  limitsFromConfig,
  runErrand,
  type ErrandLimits,
} from './modules/errands/index.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });
const call = (name: string, args: Record<string, unknown>) => ({ name, args });
const TASK = 'bachche ke project ke liye bead dazzling kit, chart paper';

// ADR-0053, rule 3: an item the customer named that the catalog does not have is confirmed in a
// checklist before any shop is asked; the agent's own extras are offered, never pre-ticked.
describe('a new item the customer named is confirmed first', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let userId: string;
  let provider: FakeProvider;
  let ai: AiContext;
  const config = testConfig();
  const limits: ErrandLimits = { ...limitsFromConfig(config), userHourlyLimit: 10_000 };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ('+919822200666', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });

  const classify = (confidence: string) =>
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence, category: 'stationery' }
        : { itemId: null, needsClarification: false },
    );
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'errands, ai_calls, requests, pings, new_item_attempts');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    await pool.query('TRUNCATE query_cache');
    provider = createFakeProvider();
    classify('high');
    ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
  });

  const deps = (over: Partial<ErrandLimits> = {}) => ({
    db: pool,
    logger,
    ai,
    limits: { ...limits, ...over },
    trigramThreshold: 0.4,
  });
  const ctx = () => ({ db: pool, logger, limits });
  const start = async (task = TASK) =>
    (await createErrand(ctx(), userId, { task, lat: ORIGIN.lat, lng: ORIGIN.lng, requestId: 'r' }))
      .id;
  const row = async (id: string) =>
    (
      await pool.query<{ state: string; question: Record<string, unknown> | null }>(
        `SELECT state, question FROM errands WHERE id = $1`,
        [id],
      )
    ).rows[0] as { state: string; question: Record<string, unknown> | null };
  const requestedItems = async () =>
    (
      await pool.query<{ name_en: string }>(
        `SELECT i.name_en FROM requests r JOIN items i ON i.id = r.item_id`,
      )
    ).rows.map((r) => r.name_en);
  const beadId = async () =>
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM items WHERE source = 'user' AND name_en ILIKE 'bead%'`,
      )
    ).rows[0]?.id as string;
  const answer = (id: string, selected: number[]) =>
    answerErrand({ ...ctx(), enqueue: async () => undefined }, userId, id, { selected });

  it('asks the checklist before any ping: named items first and ticked, the extras unticked', async () => {
    const id = await start();
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'bead dazzling kit' }),
          call('resolve_item', { text: 'chart paper' }),
          call('resolve_item', { text: 'glue stick' }),
        ],
      },
      async () => ({ toolCalls: [call('ask_shops', { itemId: await beadId() })] }),
    ]);
    await runErrand(deps(), id);
    const after = await row(id);
    expect(after.state).toBe('NEEDS_INPUT');
    expect(await requestedItems()).toEqual([]);
    expect(after.question).toEqual({
      question: 'Which of these do you need?',
      options: ['bead dazzling kit', 'chart paper', 'glue stick'],
      multiSelect: true,
      preselected: [0, 1],
    });
  });

  it('asks even when the classifier is only "medium" sure and the item stays unresolved', async () => {
    classify('medium');
    const id = await start();
    provider.playChat([{ toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] }]);
    await runErrand(deps(), id);
    expect((await row(id)).state).toBe('NEEDS_INPUT');
    expect((await row(id)).question).toMatchObject({
      options: ['bead dazzling kit', 'chart paper'],
    });
  });

  it('asks nothing when every named item is in the catalog', async () => {
    const id = await start('chini, namak');
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'namak' }),
        ],
      },
      { text: 'ok' },
      { toolCalls: [call('submit_plan', { items: [] })] },
    ]);
    await runErrand(deps(), id);
    expect((await row(id)).state).not.toBe('NEEDS_INPUT');
  });

  it('a ticked new item reaches the shops', async () => {
    const id = await start();
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      async () => ({ toolCalls: [call('ask_shops', { itemId: await beadId() })] }),
    ]);
    await runErrand(deps(), id);
    await answer(id, [0, 1]);
    await runErrand(deps(), id);
    expect(await requestedItems()).toEqual(['Bead dazzling kit']);
    expect((await row(id)).state).toBe('WAITING_FOR_SHOPS');
  });

  it('an unticked new item is never asked of shops and is not asked about again', async () => {
    const id = await start();
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      async () => ({ toolCalls: [call('ask_shops', { itemId: await beadId() })] }),
      { toolCalls: [call('submit_plan', { items: [] })] },
    ]);
    await runErrand(deps(), id);
    await answer(id, [1]); // chart paper only
    await runErrand(deps(), id);
    expect(await requestedItems()).toEqual([]);
    const after = await row(id);
    expect(after.state).not.toBe('NEEDS_INPUT');
    expect(after.state).not.toBe('WAITING_FOR_SHOPS');
  });

  it('holds a plan submitted in the same turn: the checklist comes first, no plan, no ping', async () => {
    const id = await start();
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'bead dazzling kit' }),
          call('submit_plan', { items: [{ text: 'chart paper', status: 'not_found' }] }),
        ],
      },
    ]);
    await runErrand(deps(), id);
    const after = await row(id);
    expect(after.state).toBe('NEEDS_INPUT');
    expect(after.question).toMatchObject({ options: ['bead dazzling kit', 'chart paper'] });
    expect(await requestedItems()).toEqual([]);
  });

  it('respects the question cap: no checklist once the limit is reached', async () => {
    const id = await start();
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      { toolCalls: [call('submit_plan', { items: [] })] },
    ]);
    await runErrand(deps({ maxQuestions: 0 }), id);
    expect((await row(id)).state).not.toBe('NEEDS_INPUT');
  });
});
