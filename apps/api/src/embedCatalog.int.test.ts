import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAi, createFakeProvider } from './modules/ai/index.js';
import { embedCatalog, loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { DIM } from './testing/aiFixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });

describe('embedding the catalog', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let total: number;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    total = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM items')).rows[0]
      ?.n as number;
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const make = () => {
    const provider = createFakeProvider({ dim: DIM });
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1 },
    });
    return { provider, ai };
  };
  const embeds = (p: ReturnType<typeof createFakeProvider>) =>
    p.calls.filter((c) => c.kind === 'embed');

  it('migration 008 adds a vector column, a source hash and an HNSW cosine index', async () => {
    const col = await pool.query(
      `SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
        WHERE a.attrelid = 'items'::regclass AND a.attname = 'embedding'`,
    );
    expect(col.rows[0]?.type).toBe(`vector(${DIM})`);
    const idx = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'items' AND indexdef ILIKE '%hnsw%'`,
    );
    expect(idx.rows[0]?.indexdef).toMatch(/vector_cosine_ops/);
  });

  it('embeds every item once, in batches, with name, Hindi name and synonyms', async () => {
    const { provider, ai } = make();
    const result = await embedCatalog(pool, ai, { batchSize: 50, pauseMs: 0 });
    expect(result).toEqual({ embedded: total, skipped: 0 });
    expect(embeds(provider)).toHaveLength(Math.ceil(total / 50));
    const texts = embeds(provider).flatMap((c) => (c.kind === 'embed' ? c.texts : []));
    expect(texts).toHaveLength(total);
    const wheat = texts.find((t) => t.includes('wheat flour'));
    expect(wheat).toContain('आटा');
    expect(wheat).toMatch(/aata/);
    expect(embeds(provider).every((c) => c.kind === 'embed' && c.purpose === 'embed_catalog')).toBe(
      true,
    );

    const stored = await pool.query(
      `SELECT count(*)::int AS n FROM items WHERE embedding IS NOT NULL AND embedding_source_hash IS NOT NULL`,
    );
    expect(stored.rows[0]?.n).toBe(total);
  });

  it('does nothing the second time: the source hash has not changed', async () => {
    const { provider, ai } = make();
    expect(await embedCatalog(pool, ai, { batchSize: 50, pauseMs: 0 })).toEqual({
      embedded: 0,
      skipped: total,
    });
    expect(provider.calls).toEqual([]);
  });

  it('re-embeds only the item whose synonyms changed', async () => {
    const catalog = loadSeedCatalog();
    const changed = {
      ...catalog,
      items: catalog.items.map((i) =>
        i.slug === 'sugar' ? { ...i, synonyms: [...i.synonyms, 'mishri wali chini'] } : i,
      ),
    };
    await seedCatalog(pool, changed);
    const { provider, ai } = make();
    expect(await embedCatalog(pool, ai, { batchSize: 50, pauseMs: 0 })).toEqual({
      embedded: 1,
      skipped: total - 1,
    });
    const text = embeds(provider).flatMap((c) => (c.kind === 'embed' ? c.texts : []))[0];
    expect(text).toContain('mishri wali chini');
    await seedCatalog(pool, catalog);
  });

  it('stops with an error when the provider fails, keeping what was already embedded', async () => {
    await pool.query(
      `UPDATE items SET embedding_source_hash = NULL WHERE slug IN ('sugar', 'rice', 'salt')`,
    );
    const { provider, ai } = make();
    provider.onEmbed(() => {
      throw Object.assign(new Error('down'), { status: 400 });
    });
    await expect(embedCatalog(pool, ai, { batchSize: 2, pauseMs: 0 })).rejects.toThrow();
    const done = await pool.query(
      `SELECT count(*)::int AS n FROM items WHERE embedding_source_hash IS NOT NULL`,
    );
    expect(done.rows[0]?.n).toBe(total - 3);
    const ok = make();
    expect((await embedCatalog(pool, ok.ai, { batchSize: 2, pauseMs: 0 })).embedded).toBe(3);
  });
});
