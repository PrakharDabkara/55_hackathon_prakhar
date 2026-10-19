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
  createErrand,
  getErrand,
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

// PR I: the model sometimes repeats a tool call exactly. The server answers it from the first
// result, without running it again and without counting it against any cap.
describe('an identical tool call within one errand returns the earlier result', () => {
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
        `INSERT INTO users (phone, role) VALUES ('+919822200888', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'errands, ai_calls, requests, pings, search_queries');
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

  const deps = (extra: Partial<ErrandLimits> = {}) => ({
    db: pool,
    logger,
    ai,
    limits: { ...limits, ...extra },
    trigramThreshold: 0.4,
  });
  const start = async () =>
    (
      await createErrand({ db: pool, logger, limits }, userId, {
        task: 'chini aur namak',
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        requestId: 'req-repeat',
      })
    ).id;
  const steps = async (id: string) =>
    (
      await pool.query<{
        tool_name: string;
        args: Record<string, unknown>;
        result_summary: Record<string, unknown>;
      }>(
        `SELECT tool_name, args, result_summary FROM errand_steps WHERE errand_id = $1 AND kind = 'tool' ORDER BY n`,
        [id],
      )
    ).rows;
  const toolResults = async (id: string) =>
    (
      await pool.query<{ name: string; result: unknown }>(
        `SELECT tool_name AS name, payload->'result' AS result FROM errand_steps
          WHERE errand_id = $1 AND kind = 'tool' ORDER BY n`,
        [id],
      )
    ).rows;

  it('answers a repeated resolve_item (same turn or later) from the first result and runs it once', async () => {
    const id = await start();
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'chini' }),
        ],
      },
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'namak' }),
        ],
      },
      { toolCalls: [call('submit_plan', { items: [{ text: 'chini', status: 'not_found' }] })] },
    ]);
    await runErrand(deps(), id);
    const asked = (
      await pool.query(`SELECT 1 FROM search_queries WHERE raw_text IN ('chini', 'namak')`)
    ).rowCount;
    expect(asked).toBe(2); // chini once, namak once
    const chini = (await toolResults(id)).filter(
      (r) => r.name === 'resolve_item' && JSON.stringify(r.result).includes('sugar'),
    );
    expect(chini).toHaveLength(3);
    expect(new Set(chini.map((r) => JSON.stringify(r.result))).size).toBe(1);
    const replayed = (await steps(id)).filter((s) => s.result_summary['replayed']);
    expect(replayed).toHaveLength(2);
  });

  it('does not treat different arguments as a repeat', async () => {
    const id = await start();
    provider.playChat([
      {
        toolCalls: [
          call('resolve_item', { text: 'chini' }),
          call('resolve_item', { text: 'namak' }),
        ],
      },
      { toolCalls: [call('submit_plan', { items: [{ text: 'chini', status: 'not_found' }] })] },
    ]);
    await runErrand(deps(), id);
    expect((await steps(id)).filter((s) => s.result_summary['replayed'])).toHaveLength(0);
  });

  it('a repeated ask_shops opens one request and does not use up the cap', async () => {
    const id = await start();
    const sugar = (await pool.query<{ id: string }>(`SELECT id FROM items WHERE slug = 'sugar'`))
      .rows[0]?.id as string;
    provider.playChat([
      {
        toolCalls: [call('ask_shops', { itemId: sugar }), call('ask_shops', { itemId: sugar })],
      },
      { text: 'asked' },
    ]);
    await runErrand(deps({ maxAskShops: 1 }), id);
    expect((await pool.query('SELECT 1 FROM requests')).rowCount).toBe(1);
    const results = (await toolResults(id)).filter((r) => r.name === 'ask_shops');
    expect(results).toHaveLength(2);
    expect(JSON.stringify(results[1]?.result)).not.toMatch(/limit|cap|too many/i);
  });

  it('survives a restart: a call repeated in a later run is still answered from the log', async () => {
    const id = await start();
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'chini' })] },
      { text: 'thinking' },
    ]);
    await runErrand(deps(), id);
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'chini' })] },
      { toolCalls: [call('submit_plan', { items: [{ text: 'chini', status: 'not_found' }] })] },
    ]);
    await pool.query(`UPDATE errands SET state = 'PLANNING', lease_until = NULL WHERE id = $1`, [
      id,
    ]);
    await runErrand(deps(), id);
    expect(
      (await pool.query(`SELECT 1 FROM search_queries WHERE raw_text = 'chini'`)).rowCount,
    ).toBe(1);
    expect(await getErrand({ db: pool, logger }, userId, id)).not.toBeNull();
  });
});
