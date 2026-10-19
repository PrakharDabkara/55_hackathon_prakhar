import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildResolvePrompt,
  createAi,
  createFakeProvider,
  type AiContext,
} from './modules/ai/index.js';
import { loadSeedCatalog, resolveItem, seedCatalog } from './modules/catalog/index.js';
import { buildSystemPrompt } from './modules/errands/prompt.js';
import { DIM, setEmbeddings, vec } from './testing/aiFixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

// PR I: general causes behind the dev misses of the PR #38 resolve run.
describe('resolve: things that are not products never reach the model, and a model question is for short words', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let ai: AiContext;
  const provider = createFakeProvider({ dim: DIM });
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    for (const r of (await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items'))
      .rows)
      ids[r.slug] = r.id;
    ai = createAi({
      provider,
      db: pool,
      logger: pino({ level: 'silent' }),
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE query_cache, suggested_synonyms, ai_calls, search_queries');
    await pool.query('UPDATE items SET embedding = NULL');
    await setEmbeddings(pool, {
      'paper-clips': vec({ 1: 1 }),
      'clothes-clips': vec({ 1: 0.97, 2: 0.2 }),
      'floor-cleaner': vec({ 1: 0.9, 3: 0.3 }),
    });
    provider.calls.length = 0;
    provider.onEmbed((texts) => texts.map(() => vec({ 1: 1 })));
    provider.onGenerate(() => ({
      itemId: null,
      needsClarification: true,
      question: 'Kaunsa chahiye?',
      optionIds: [ids['paper-clips'], ids['clothes-clips']],
    }));
  });
  const resolve = (q: string) => resolveItem(pool, q, { threshold: 0.4, ai });

  it.each(['dentist', 'plumber chahiye', 'electric car', 'indore', 'samsung galaxy s24'])(
    '"%s" is not a product: no item, no question, and the model is never called',
    async (q) => {
      const r = await resolve(q);
      expect(r.item).toBeNull();
      expect(r.ambiguous).toBeUndefined();
      expect(provider.calls).toEqual([]);
    },
  );

  it('still lets an accessory of a big thing reach the catalog steps ("car freshener", "phone cover")', async () => {
    expect((await resolve('phone cover')).item?.slug).toBe('phone-cover');
  });

  it('asks a model question for a short generic word, as before', async () => {
    expect((await resolve('zzq clip')).ambiguous?.question).toBe('Kaunsa chahiye?');
  });

  it('does not ask about a long specific product ("ice cream scoop holder"): not in the catalog', async () => {
    const r = await resolve('ice cream scoop holder');
    expect(r.item).toBeNull();
    expect(r.ambiguous).toBeUndefined();
  });

  it('tells the model that a brand is not the generic item of its kind', () => {
    const { system } = buildResolvePrompt('mentos', []);
    expect(system).toMatch(/brand/i);
    expect(system).toMatch(/mentos/i);
  });

  it('tells the model that professions, services and vehicles are not products', () => {
    const { system } = buildResolvePrompt('x', []);
    expect(system).toMatch(/plumber|dentist|profession/i);
  });
});

describe('errand prompt for a school project', () => {
  it('ticks the usual extras glue and scissors', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toMatch(/school project[^.]*always tick[^.]*glue[^.]*scissors/i);
  });
});
