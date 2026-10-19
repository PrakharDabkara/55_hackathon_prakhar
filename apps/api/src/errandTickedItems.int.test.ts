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

// Dev case d18: a person who ticked an item in the checklist confirmed it is a real thing, so the
// classifier's "medium" is enough to create it. A plain search still needs "high" (ADR-0036).
describe('items the customer ticked in the errand checklist can be created at medium confidence', () => {
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
        `INSERT INTO users (phone, role) VALUES ('+919822200777', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'errands, ai_calls, requests, pings, new_item_attempts');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    await pool.query('TRUNCATE query_cache');
    provider = createFakeProvider();
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'medium', category: 'stationery' }
        : { itemId: null, needsClarification: false },
    );
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

  const deps = () => ({ db: pool, logger, ai, limits, trigramThreshold: 0.4 });
  const ctx = () => ({ db: pool, logger, limits });
  const start = async () =>
    (
      await createErrand(ctx(), userId, {
        task: 'bachche ke project ke liye saaman',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        requestId: 'req-ticked',
      })
    ).id;
  const resolved = () =>
    provider.calls
      .filter((c) => c.kind === 'chat')
      .flatMap(
        (c) => (c as unknown as { messages: { role: string; results?: unknown[] }[] }).messages,
      )
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.results ?? []) as { name: string; result: Record<string, unknown> }[];
  const userItems = async () =>
    (
      await pool.query<{ name_en: string }>(`SELECT name_en FROM items WHERE source = 'user'`)
    ).rows.map((r) => r.name_en);

  async function checklistThenResolve(
    selected: number[],
    text: string | undefined,
    words: string[],
  ) {
    const id = await start();
    provider.playChat([
      {
        toolCalls: [
          call('ask_user', {
            question: 'Ye cheezein chahiye?',
            options: ['bead dazzling kit', 'foam sheet', 'chart paper'],
            multiSelect: true,
            preselected: [0, 1],
          }),
        ],
      },
      { toolCalls: words.map((w) => call('resolve_item', { text: w })) },
      { text: 'ok' },
    ]);
    await runErrand(deps(), id);
    await answerErrand(
      { ...ctx(), enqueue: async () => undefined },
      userId,
      id,
      text ? { selected, text } : { selected },
    );
    await runErrand(deps(), id);
  }

  it('creates a ticked item the classifier is only "medium" sure about', async () => {
    await checklistThenResolve([0], undefined, ['bead dazzling kit']);
    expect(await userItems()).toEqual(['Bead dazzling kit']);
    expect(resolved().find((r) => r.name === 'resolve_item')?.result).toMatchObject({
      item: { name: 'Bead dazzling kit', isNew: true },
    });
  });

  it('counts a word the customer typed under the checklist as ticked', async () => {
    await checklistThenResolve([2], 'rangoli stencil', ['rangoli stencil']);
    expect(await userItems()).toEqual(['Rangoli stencil']);
  });

  it('does not create an item the customer did not tick', async () => {
    await checklistThenResolve([2], undefined, ['bead dazzling kit']);
    expect(await userItems()).toEqual([]);
    expect(resolved().find((r) => r.name === 'resolve_item')?.result).toMatchObject({
      unresolved: true,
    });
  });

  it('still refuses a low-confidence answer for a ticked item', async () => {
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'low', category: 'stationery' }
        : { itemId: null, needsClarification: false },
    );
    await checklistThenResolve([0], undefined, ['bead dazzling kit']);
    expect(await userItems()).toEqual([]);
  });
});
