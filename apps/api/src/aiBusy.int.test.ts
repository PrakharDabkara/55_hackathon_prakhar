import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, createGeminiProvider } from './modules/ai/index.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { truncateKeepingShops } from './testing/truncate.js';

const logger = pino({ level: 'silent' });
const observedDir = path.resolve(import.meta.dirname, 'testing/observed');
const fixtures = readdirSync(observedDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('gemini-ci'))
  .map((f) => JSON.parse(readFileSync(path.join(observedDir, f), 'utf8')))
  .filter((f) => (f.source ?? '').startsWith('scripts/probe/') && typeof f.status === 'number');
const observed = (kind: string) => {
  const f = fixtures.find((x) => x.kind === kind);
  if (!f) throw new Error(`no observed fixture of kind ${kind}`);
  return Object.assign(new Error(JSON.stringify(f.body)), { status: f.status as number });
};
const busy503 = () =>
  Object.assign(
    new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: 'This model is currently experiencing high demand.',
          status: 'UNAVAILABLE',
        },
      }),
    ),
    { status: 503 },
  );

/**
 * PR app round 2, C-15: when the AI call FAILS (503, 429 per minute, 429 per day, a timeout) the
 * customer is told the assistant is busy, with a ref, and never "we couldn't understand that
 * item". A Find waits on the AI for 15 s at most (here: 150 ms).
 */
describe('a Find while the AI fails', () => {
  let testDb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'requests, pings, new_item_attempts, query_cache');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
  });

  /** An app whose Gemini adapter answers every model call with `respond`. */
  async function appWith(respond: () => unknown, budgetMs = 150) {
    const generateContent = async () => respond();
    const provider = createGeminiProvider({
      client: { models: { generateContent, embedContent: generateContent } } as never,
      model: 'primary',
      fallbackModel: 'fallback',
      embedModel: 'embed',
      embedDim: 768,
    });
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      resolveBudgetMs: budgetMs,
      client: { backoffMs: 1, retries: 1, timeoutMs: 5000 },
    });
    const app = createApp({ config: testConfig(), logger, db: pool, ai });
    const seeker = await loginAs(
      app,
      'seeker',
      String(9_840_000_000 + Math.floor(Math.random() * 1e6)),
    );
    const ask = (body: Record<string, unknown>) =>
      request(app)
        .post('/requests')
        .set({ Authorization: `Bearer ${seeker.token}` })
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
    return { ask, app, seeker };
  }

  const failures: [string, () => unknown][] = [
    [
      '503 UNAVAILABLE',
      () => {
        throw busy503();
      },
    ],
    [
      '429 per minute (observed)',
      () => {
        throw observed('429-per-minute');
      },
    ],
    [
      '429 per day (observed)',
      () => {
        throw observed('429-per-day');
      },
    ],
  ];

  it.each(failures)('%s: "assistant busy" with a ref, not "unresolved"', async (_name, fail) => {
    const { ask } = await appWith(fail);
    for (const q of ['Mobile phone', 'Walnuts, 500g', 'wireless charger pad']) {
      const res = await ask({ q });
      expect(res.status, q).toBe(503);
      expect(res.body.error.code, q).toBe('ai_busy');
      expect(res.body.error.requestId, q).toBeTruthy();
    }
    expect((await pool.query(`SELECT 1 FROM requests`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM items WHERE source = 'user'`)).rowCount).toBe(0);
  });

  it('a call that never answers is cut at the budget, not after 40 s', async () => {
    const { ask } = await appWith(() => new Promise(() => undefined), 150);
    const started = Date.now();
    const res = await ask({ q: 'Mobile phone' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_busy');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('"search exactly what I typed" while the AI fails is also "assistant busy"', async () => {
    const { ask } = await appWith(() => {
      throw busy503();
    });
    const res = await ask({ q: 'Mobile phone', asTyped: true });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_busy');
  });

  it('the free steps still answer while the AI fails (a catalog word needs no model)', async () => {
    const { ask } = await appWith(() => {
      throw busy503();
    });
    const res = await ask({ q: 'pencil' });
    expect(res.status).toBe(201);
  });
});

describe('a Find while the AI works', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let ask: (body: Record<string, unknown>) => request.Test;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const provider = createFakeProvider();
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'allowed', confidence: 'high', category: 'grocery' }
        : { itemId: null, needsClarification: false },
    );
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
    const app = createApp({ config: testConfig(), logger, db: pool, ai });
    const seeker = await loginAs(app, 'seeker', '9850000011');
    ask = (body) =>
      request(app)
        .post('/requests')
        .set({ Authorization: `Bearer ${seeker.token}` })
        .send({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...body });
    // Scripted per test below through the provider.
    (ask as unknown as { provider: typeof provider }).provider = provider;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await truncateKeepingShops(pool, 'requests, pings, new_item_attempts, query_cache');
    await pool.query(`DELETE FROM items WHERE source = 'user'`);
  });

  it('"Walnuts, 500g" is a real item with a quantity (the comma did not make it unclear)', async () => {
    const res = await ask({ q: 'Walnuts, 500g' });
    expect(res.status).toBe(201);
    expect(res.body.item.nameEn).toBe('Walnuts');
    expect(res.body.quantity).toMatchObject({ quantity: 500 });
  });

  it('text the classifier calls nonsense is still "unresolved" (a real 422, not a failure)', async () => {
    const provider = (ask as unknown as { provider: ReturnType<typeof createFakeProvider> })
      .provider;
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'nonsense', confidence: 'high' }
        : { itemId: null, needsClarification: false },
    );
    const res = await ask({ q: 'lorem ipsum dolor' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('item_unresolved');
  });

  it('"exactly what I typed" with a doubtful classifier asks general stores instead of giving up', async () => {
    const provider = (ask as unknown as { provider: ReturnType<typeof createFakeProvider> })
      .provider;
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'unsure', confidence: 'low' }
        : { itemId: null, needsClarification: false },
    );
    const plain = await ask({ q: 'Softtoy' });
    expect(plain.status).toBe(422);
    const res = await ask({ q: 'Softtoy', asTyped: true });
    expect(res.status).toBe(201);
    expect(res.body.item.category).toBe('general_store');
    const row = await pool.query(`SELECT uncategorised FROM items WHERE source = 'user'`);
    expect(row.rows).toEqual([{ uncategorised: true }]);
  });

  it('"exactly what I typed" still refuses a blocked item', async () => {
    const provider = (ask as unknown as { provider: ReturnType<typeof createFakeProvider> })
      .provider;
    provider.onGenerate(({ purpose }) =>
      purpose === 'classify_item'
        ? { verdict: 'blocked', confidence: 'high' }
        : { itemId: null, needsClarification: false },
    );
    const res = await ask({ q: 'Softtoy', asTyped: true });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('item_blocked');
  });
});
