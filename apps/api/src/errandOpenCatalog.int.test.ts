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
import { north, ORIGIN } from './testing/fixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });
const call = (name: string, args: Record<string, unknown>) => ({ name, args });
const submit = (items: unknown[]) => call('submit_plan', { items });

// ADR-0028: the errand agent adds items to the catalog as it goes, and never sends a blocked one.
describe('errand agent with the open catalog', () => {
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
        `INSERT INTO users (phone, role) VALUES ('+919822200301', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE errands, ai_calls, requests, pings, new_item_attempts CASCADE');
    await pool.query(`DELETE FROM shops`);
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
    await pool.query('TRUNCATE query_cache');
    provider = createFakeProvider();
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', category: 'stationery' }
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

  const shop = async (name: string, km: number, categories: string[]) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO shops (name, phone, categories, location)
         VALUES ($1, '+910000000000', $4::text[],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING id`,
        [name, ORIGIN.lng, north(km), categories],
      )
    ).rows[0]?.id as string;
  const deps = () => ({ db: pool, logger, ai, limits, trigramThreshold: 0.4 });
  const start = async (task: string) =>
    (
      await createErrand({ db: pool, logger, limits }, userId, {
        task,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        requestId: 'req-open-1',
      })
    ).id;
  const chat = () => provider.calls.filter((c) => c.kind === 'chat');
  const toolResult = (index: number) => {
    const messages = (
      chat()[index] as unknown as { messages: { role: string; results?: unknown[] }[] }
    ).messages;
    return (messages.filter((m) => m.role === 'tool').at(-1)?.results ?? []) as {
      result: Record<string, unknown>;
    }[];
  };
  const view = async (id: string) =>
    (await getErrand({ db: pool, logger }, userId, id)) as NonNullable<
      Awaited<ReturnType<typeof getErrand>>
    >;
  type PlanRow = Record<string, unknown>;
  const planItems = (v: Awaited<ReturnType<typeof view>>) =>
    (v.plan as unknown as { items: PlanRow[] }).items;

  it('a real unknown product is created, asked as plain text to the right shops, and tagged as new', async () => {
    const stationers = await Promise.all(
      [0.2, 0.5, 0.8].map((km, n) => shop(`Stationer ${n}`, km, ['stationery'])),
    );
    await shop('Hardware', 0.1, ['hardware']);
    const id = await start('bead dazzling kit chahiye');
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      (request) => {
        const item = (toolResult0(request) as { item: { id: string } }).item;
        return { toolCalls: [call('ask_shops', { itemId: item.id })] };
      },
      { text: 'asked' },
    ]);
    function toolResult0(request: { messages: { role: string; results?: unknown[] }[] }) {
      const last = request.messages.filter((m) => m.role === 'tool').at(-1);
      return (last?.results?.[0] as { result: unknown }).result;
    }
    await runErrand(deps(), id);

    const told = toolResult(1)[0]?.result as { item: Record<string, unknown> };
    expect(told.item).toMatchObject({
      name: 'Bead dazzling kit',
      category: 'stationery',
      isNew: true,
    });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM requests WHERE user_id = $1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    // The fan-out is the worker's job; select the targets it would pick.
    const { fanOutPings } = await import('./modules/requests/index.js');
    await fanOutPings(
      { db: pool, logger, config: { maxPings: 10 } },
      (rows[0] as { id: string }).id,
      {
        claim: async () => true,
        release: async () => undefined,
      },
    );
    const asked = (
      await pool.query<{ shop_id: string }>(`SELECT shop_id FROM pings WHERE request_id = $1`, [
        (rows[0] as { id: string }).id,
      ])
    ).rows.map((r) => r.shop_id);
    expect(asked.sort()).toEqual([...stationers].sort());

    expect((await view(id)).progress).toContain('Nayi cheez: dukaanon se pooch rahe hain');
  });

  it('the model sees the item name and category only: no user id, phone or location', async () => {
    const id = await start('bead dazzling kit');
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      { toolCalls: [submit([{ text: 'bead dazzling kit', status: 'not_found' }])] },
    ]);
    await runErrand(deps(), id);
    const sent = JSON.stringify(provider.calls);
    for (const secret of [userId, '+919822200301', String(ORIGIN.lat), String(ORIGIN.lng)])
      expect(sent).not.toContain(secret);
  });

  it('a blocked item is never created or sent: the model is told, the plan says why', async () => {
    const id = await start('ek pistol chahiye');
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'country made pistol' })] },
      { toolCalls: [submit([{ text: 'country made pistol', status: 'not_found' }])] },
    ]);
    await runErrand(deps(), id);
    const told = toolResult(1)[0]?.result as Record<string, unknown>;
    expect(told).toMatchObject({ blocked: true });
    expect(told['item']).toBeUndefined();
    expect(JSON.stringify(told)).toMatch(/not_found/);
    expect((await pool.query(`SELECT 1 FROM requests`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
    const v = await view(id);
    expect(planItems(v)[0]).toMatchObject({
      text: 'country made pistol',
      status: 'not_found',
      refused: 'blocked',
    });
    expect(v.progress).toContain('Ye cheez hum dukaanon ko nahi bhej sakte');
    expect(provider.calls.filter((c) => c.kind === 'generate')).toHaveLength(0);
  });

  it('with the classifier down the item is not sent and the plan says so', async () => {
    provider.onGenerate(() => {
      throw new Error('down');
    });
    const id = await start('bead dazzling kit');
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      { toolCalls: [submit([{ text: 'bead dazzling kit', status: 'not_found' }])] },
    ]);
    await runErrand(deps(), id);
    expect(toolResult(1)[0]?.result).toMatchObject({ unavailable: true });
    const v = await view(id);
    expect(planItems(v)[0]).toMatchObject({ status: 'not_found', refused: 'unavailable' });
    expect(v.progress).toContain('Abhi ye cheez dukaanon ko nahi bhej sakte');
    expect((await pool.query(`SELECT 1 FROM requests`)).rowCount).toBe(0);
  });

  it('at most five new items per errand; the sixth gets a plain refusal', async () => {
    const words = ['qzorv', 'xblin', 'zumqo', 'flqrn', 'gribx', 'snqrf'].map((w) => `${w} kit`);
    const id = await start('school project');
    provider.playChat([
      { toolCalls: words.map((text) => call('resolve_item', { text })) },
      { toolCalls: [submit(words.map((text) => ({ text, status: 'not_found' })))] },
    ]);
    await runErrand(deps(), id);
    const results = toolResult(1).map((r) => r.result);
    expect(results.filter((r) => r['item'])).toHaveLength(5);
    expect(results.at(-1)).toMatchObject({ limit: true });
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(5);
    const v = await view(id);
    expect(planItems(v).find((i) => i['text'] === 'snqrf kit')).toMatchObject({ refused: 'limit' });
  });

  it('a new item that no shop has confirmed stays "not found" with its name and the isNew tag', async () => {
    const id = await start('bead dazzling kit');
    provider.playChat([
      { toolCalls: [call('resolve_item', { text: 'bead dazzling kit' })] },
      async () => {
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id FROM items WHERE source = 'user'`,
        );
        return {
          toolCalls: [
            submit([{ text: 'bead dazzling kit', itemId: rows[0]?.id, status: 'not_found' }]),
          ],
        };
      },
    ]);
    await runErrand(deps(), id);
    const v = await view(id);
    expect(planItems(v)[0]).toMatchObject({
      status: 'not_found',
      itemName: 'Bead dazzling kit',
      isNew: true,
      refused: null,
    });
  });
});
