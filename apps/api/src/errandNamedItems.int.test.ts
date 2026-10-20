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

// ADR-0049: in code, not only in the prompt, everything the customer named is in the plan or in a
// question, and nothing the agent added on its own is asked of shops before the customer confirmed it.
describe("the errand rule: named items are kept, the agent's own additions are confirmed first", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let userId: string;
  let provider: FakeProvider;
  let ai: AiContext;
  let sugar: string;
  let salt: string;
  const config = testConfig();
  const limits: ErrandLimits = { ...limitsFromConfig(config), userHourlyLimit: 10_000 };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ('+919822200888', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
    const id = async (slug: string) =>
      (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = $1`, [slug])).rows[0]
        ?.id as string;
    sugar = await id('sugar');
    salt = await id('salt');
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'errands, ai_calls, requests, pings, new_item_attempts');
    await pool.query('TRUNCATE query_cache');
    provider = createFakeProvider();
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
  const start = async (task: string) =>
    (await createErrand(ctx(), userId, { task, lat: ORIGIN.lat, lng: ORIGIN.lng, requestId: 'r' }))
      .id;
  const row = async (id: string) =>
    (
      await pool.query<{ state: string; question: Record<string, unknown> | null; plan: unknown }>(
        `SELECT state, question, plan FROM errands WHERE id = $1`,
        [id],
      )
    ).rows[0] as { state: string; question: Record<string, unknown> | null; plan: unknown };
  const requests = async () => (await pool.query(`SELECT 1 FROM requests`)).rowCount;
  const answer = (id: string, body: { selected: number[]; text?: string }) =>
    answerErrand({ ...ctx(), enqueue: async () => undefined }, userId, id, body);

  it('asks no shop for items the agent chose for a goal: the customer confirms a checklist first', async () => {
    const id = await start('poha banane ka saaman');
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'namak' }),
        ],
      },
      { toolCalls: [call('ask_shops', { itemId: sugar }), call('ask_shops', { itemId: salt })] },
    ]);
    await runErrand(deps(), id);
    const after = await row(id);
    expect(after.state).toBe('NEEDS_INPUT');
    expect(await requests()).toBe(0);
    expect(after.question).toMatchObject({
      question: 'Which of these do you need?',
      options: ['chini', 'namak'],
      multiSelect: true,
      preselected: [0, 1],
    });
  });

  it('lets the agent ask shops about what the customer ticked, and only that', async () => {
    const id = await start('poha banane ka saaman');
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'namak' }),
        ],
      },
      { toolCalls: [call('ask_shops', { itemId: sugar }), call('ask_shops', { itemId: salt })] },
      // After the answer the agent tries both again.
      { toolCalls: [call('ask_shops', { itemId: sugar }), call('ask_shops', { itemId: salt })] },
    ]);
    await runErrand(deps(), id);
    await answer(id, { selected: [0] }); // chini only: namak is declined
    await runErrand(deps(), id);
    const after = await row(id);
    // One request, for the ticked item. The declined one is never asked and never re-asked.
    expect(await requests()).toBe(1);
    expect(after.state).toBe('WAITING_FOR_SHOPS');
    expect(
      (await pool.query<{ item_id: string }>(`SELECT item_id FROM requests`)).rows[0]?.item_id,
    ).toBe(sugar);
  });

  it('asks shops at once, with no question, when the customer named every item', async () => {
    const id = await start('chini, namak');
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'namak' }),
        ],
      },
      { toolCalls: [call('ask_shops', { itemId: sugar }), call('ask_shops', { itemId: salt })] },
    ]);
    await runErrand(deps(), id);
    expect((await row(id)).state).toBe('WAITING_FOR_SHOPS');
    expect(await requests()).toBe(2);
  });

  it('adds a named item the agent left out of its checklist, ticked', async () => {
    const id = await start('chini, namak, atta');
    provider.playChat([
      {
        toolCalls: [
          call('ask_user', {
            question: 'Which of these do you need?',
            options: ['chini', 'biscuits'],
            multiSelect: true,
            preselected: [0],
          }),
        ],
      },
    ]);
    await runErrand(deps(), id);
    const q = (await row(id)).question as { options: string[]; preselected: number[] };
    expect(q.options).toEqual(['chini', 'biscuits', 'namak', 'atta']);
    expect([...q.preselected].sort()).toEqual([0, 2, 3]);
  });

  it('lists a named item the agent left out of the plan, as not found', async () => {
    const id = await start('chini, namak');
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'chini' })] },
      { toolCalls: [call('submit_plan', { items: [{ text: 'chini', status: 'not_found' }] })] },
    ]);
    await runErrand(deps(), id);
    const plan = (await row(id)).plan as { items: { text: string; status: string }[] };
    expect(plan.items.map((i) => [i.text, i.status])).toEqual([
      ['chini', 'not_found'],
      ['namak', 'not_found'],
    ]);
  });

  it('does not repair a single-choice question: it is not a list', async () => {
    const id = await start('chini, namak');
    provider.playChat([
      { toolCalls: [call('ask_user', { question: 'Which sugar?', options: ['loose', 'packed'] })] },
    ]);
    await runErrand(deps(), id);
    expect((await row(id)).question).toMatchObject({ options: ['loose', 'packed'] });
  });
});
