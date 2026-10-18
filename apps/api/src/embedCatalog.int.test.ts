import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAi, createFakeProvider } from './modules/ai/index.js';
import {
  countPendingEmbeddings,
  embedCatalog,
  embedCatalogSafely,
  formatEmbedSummary,
  loadSeedCatalog,
  seedCatalog,
} from './modules/catalog/index.js';
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

  describe('a deploy whose embedding step fails does not stop the deploy (ADR-0021)', () => {
    it('counts the items still to embed: all of them, then none, then only the changed one', async () => {
      await pool.query('UPDATE items SET embedding = NULL, embedding_source_hash = NULL');
      const { ai } = make();
      expect(await countPendingEmbeddings(pool, ai)).toBe(total);
      await embedCatalog(pool, ai, { batchSize: 500, pauseMs: 0 });
      expect(await countPendingEmbeddings(pool, ai)).toBe(0);
      await pool.query(`UPDATE items SET name_en = name_en || ' x' WHERE slug = 'sugar'`);
      expect(await countPendingEmbeddings(pool, ai)).toBe(1);
      await pool.query(
        `UPDATE items SET name_en = replace(name_en, ' x', '') WHERE slug = 'sugar'`,
      );
    });

    it('never counts or embeds customer-made items', async () => {
      await pool.query(
        `INSERT INTO items (slug, name_en, name_hi, category, source, unverified)
         VALUES ('u-testtesttest', 'Bead kit', 'Bead kit', 'stationery', 'user', true)`,
      );
      const { ai, provider } = make();
      expect(await countPendingEmbeddings(pool, ai)).toBe(0);
      provider.calls.length = 0;
      await embedCatalog(pool, ai, { batchSize: 500, pauseMs: 0 });
      expect(embeds(provider)).toHaveLength(0);
      await pool.query(`DELETE FROM items WHERE source = 'user'`);
    });

    it('a failure part-way is reported, not thrown: the batches done stay, the rest are counted', async () => {
      await pool.query('UPDATE items SET embedding = NULL, embedding_source_hash = NULL');
      const { ai, provider } = make();
      let batches = 0;
      provider.onEmbed((texts) => {
        if (++batches >= 2) {
          throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
        }
        return texts.map(() => new Array<number>(DIM).fill(0.01));
      });
      const result = await embedCatalogSafely(pool, ai, { batchSize: 50, pauseMs: 0 });
      expect(result.ok).toBe(false);
      expect(result.embedded).toBe(50);
      expect(result.pending).toBe(total - 50);
      expect(result.reason).toMatch(/embedding stopped|unavailable|429/i);
      expect(await countPendingEmbeddings(pool, ai)).toBe(total - 50);

      // The next deploy carries on where this one stopped, with no extra work for the done items.
      const next = make();
      const again = await embedCatalogSafely(pool, next.ai, { batchSize: 500, pauseMs: 0 });
      expect(again).toMatchObject({ ok: true, embedded: total - 50, pending: 0 });
    });

    it('a failure before any batch counts everything as pending', async () => {
      await pool.query('UPDATE items SET embedding = NULL, embedding_source_hash = NULL');
      const { ai, provider } = make();
      provider.onEmbed(() => {
        throw new Error('network');
      });
      const result = await embedCatalogSafely(pool, ai, { batchSize: 50, pauseMs: 0 });
      expect(result).toMatchObject({ ok: false, embedded: 0, pending: total });
      await embedCatalog(pool, make().ai, { batchSize: 500, pauseMs: 0 });
    });

    it('writes a clear summary: how many items are still un-embedded and what happens next', () => {
      const text = formatEmbedSummary({
        ok: false,
        embedded: 50,
        pending: 229,
        reason: 'embedding stopped after 50 of 279 items (http)',
      });
      expect(text).toContain('229');
      expect(text).toMatch(/un-embedded/i);
      expect(text).toMatch(/next deploy/i);
      expect(text).toMatch(/still ran|deploy (went|continued)/i);
      const fine = formatEmbedSummary({ ok: true, embedded: 3, pending: 0, reason: null });
      expect(fine).not.toMatch(/un-embedded/i);
      expect(fine).toContain('3');
    });
  });
});
