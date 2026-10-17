import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAi, createFakeProvider, type AiContext } from './modules/ai/index.js';
import {
  CATALOG_VERSION,
  loadSeedCatalog,
  resolveItem,
  seedCatalog,
} from './modules/catalog/index.js';
import seedJson from './modules/catalog/catalog.seed.json' with { type: 'json' };
import { catalogVersionOf } from './modules/catalog/seedData.js';
import { DIM, setEmbeddings, vec } from './testing/aiFixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const quiet = pino({ level: 'silent' });

// "chandan itr" (attar, a perfume) once resolved to "sandalwood powder" at the trigram step and a
// shop confirmed it. A form word in the query that the item's own name contradicts rejects the
// item at every step: cache, synonym, trigram, default, embeddings and the model's pick.
describe('product-form guard in resolve (itr is not powder)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM items');
    for (const r of rows) ids[r.slug] = r.id;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE query_cache, ai_calls, search_queries, suggested_synonyms');
    await pool.query('DELETE FROM item_synonyms WHERE term LIKE $1', ['zz%']);
    await pool.query('DELETE FROM item_defaults WHERE term LIKE $1', ['zz%']);
    await pool.query('UPDATE items SET embedding = NULL, embedding_source_hash = NULL');
  });

  const setup = () => {
    const provider = createFakeProvider({ dim: DIM });
    const ai: AiContext = createAi({
      provider,
      db: pool,
      logger: quiet,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1 },
    });
    return { provider, ai };
  };
  const free = (q: string) => resolveItem(pool, q, { threshold: 0.4 });

  it('trigram: "chandan itr" no longer lands on sandalwood powder; nothing is found', async () => {
    const r = await free('chandan itr');
    expect(r.item).toBeNull();
    expect(r.matchedBy).toBeNull();
  });

  it('other itr queries and the same-form positives', async () => {
    expect((await free('gulab itr')).item).toBeNull();
    expect((await free('chandan powder')).item?.slug).toBe('chandan');
    expect((await free('chandan')).item?.slug).toBe('chandan');
    expect((await free('sarson tel')).item?.slug).toBe('mustard-oil');
    expect((await free('haldi powder')).item?.slug).toBe('turmeric-powder');
  });

  it('synonym: a wrong synonym row is not served', async () => {
    await pool.query(`INSERT INTO item_synonyms (term, item_id) VALUES ('zzchandan itr', $1)`, [
      ids['chandan'],
    ]);
    expect((await free('zzchandan itr')).item).toBeNull();
  });

  it('default: a wrong default is not served', async () => {
    await pool.query(`INSERT INTO item_defaults (term, item_id) VALUES ('zzgulab itr', $1)`, [
      ids['chandan'],
    ]);
    expect((await free('zzgulab itr')).item).toBeNull();
  });

  it('cache: a wrong cached answer is ignored, and does not come back', async () => {
    await pool.query(
      `INSERT INTO query_cache (normalised, item_id, method, catalog_version, expires_at)
       VALUES ('zzmogra itr', $1, 'llm', $2, now() + interval '30 days')`,
      [ids['chandan'], CATALOG_VERSION],
    );
    const { ai } = setup();
    const r = await resolveItem(pool, 'zzmogra itr', { threshold: 0.4, ai });
    expect(r.item).toBeNull();
    expect(r.matchedBy).not.toBe('cache');
  });

  it('cache: a cached question that offers a conflicting item is ignored', async () => {
    await pool.query(
      `INSERT INTO query_cache (normalised, item_id, method, question, options, catalog_version, expires_at)
       VALUES ('zzkesar itr', NULL, 'llm', 'Kaunsa?', $1, $2, now() + interval '30 days')`,
      [JSON.stringify([ids['chandan'], ids['sugar']]), CATALOG_VERSION],
    );
    const r = await resolveItem(pool, 'zzkesar itr', { threshold: 0.4 });
    expect(r.ambiguous).toBeUndefined();
    expect(r.item).toBeNull();
  });

  it('embeddings: a close vector of a conflicting item is not accepted', async () => {
    const { provider, ai } = setup();
    await setEmbeddings(pool, { chandan: vec({ 1: 1 }) });
    provider.onEmbed((texts) => texts.map(() => vec({ 1: 1 })));
    provider.onGenerate(() => ({ itemId: ids['chandan'], needsClarification: false }));
    const r = await resolveItem(pool, 'chandan itr', { threshold: 0.4, ai });
    expect(r.item).toBeNull();
  });

  it('LLM: the conflicting item is not on the shortlist, and a pick of it anyway is refused', async () => {
    const { provider, ai } = setup();
    await setEmbeddings(pool, { chandan: vec({ 1: 1 }), sugar: vec({ 1: 1, 2: 1 }) });
    provider.onEmbed((texts) => texts.map(() => vec({ 1: 1 })));
    const shown: string[] = [];
    provider.onGenerate(({ user }) => {
      shown.push(user);
      return { itemId: ids['chandan'], needsClarification: false };
    });
    const r = await resolveItem(pool, 'zzperfume itr', { threshold: 0.4, ai });
    expect(r.item).toBeNull();
    for (const text of shown) expect(text).not.toMatch(/sandalwood powder/);
  });

  it('never falls back to the nearest item when the only candidates conflict', async () => {
    const { provider, ai } = setup();
    await setEmbeddings(pool, { chandan: vec({ 1: 1 }) });
    provider.onEmbed((texts) => texts.map(() => vec({ 1: 0.9, 2: 0.4 })));
    provider.onGenerate(() => ({ itemId: ids['chandan'], needsClarification: false }));
    const r = await resolveItem(pool, 'chandan itr', { threshold: 0.4, ai });
    expect(r.item).toBeNull();
    expect(r.ambiguous).toBeUndefined();
  });

  it('the cache version covers the form list, so changing the list retires old answers', () => {
    expect(CATALOG_VERSION).toMatch(/^[0-9a-f]{16}$/);
    expect(CATALOG_VERSION).not.toBe(catalogVersionOf(loadSeedCatalog()));
    expect(CATALOG_VERSION).not.toBe(catalogVersionOf(seedJson));
  });
});
