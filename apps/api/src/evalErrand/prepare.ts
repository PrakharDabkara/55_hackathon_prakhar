import { existsSync, readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { saveEmbeddings } from '../evalEmbeddings.js';
import type { AiContext } from '../modules/ai/index.js';
import { embedCatalog, loadSeedCatalog, seedCatalog } from '../modules/catalog/index.js';

/**
 * Seeds the catalog and gets its embeddings: the vectors an earlier run saved (the CI cache, keyed
 * by the catalog file) are loaded first, so only items whose text changed cost a request. The
 * agent's item resolution uses them exactly as production does.
 */
export async function prepareCatalog(
  pool: Pool,
  embedder: AiContext,
  vectorFile: string,
  log: (line: string) => void,
): Promise<void> {
  await seedCatalog(pool, loadSeedCatalog());
  if (existsSync(vectorFile)) {
    const saved = JSON.parse(readFileSync(vectorFile, 'utf8')) as {
      slug: string;
      hash: string;
      vector: string;
    }[];
    for (const v of saved)
      await pool.query(
        `UPDATE items SET embedding = $2::vector, embedding_source_hash = $3 WHERE slug = $1`,
        [v.slug, v.vector, v.hash],
      );
    log(`loaded ${saved.length} saved embeddings`);
  }
  let embedded = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      embedded += (
        await embedCatalog(pool, embedder, {
          batchSize: 20,
          pauseMs: 4000,
          onBatch: () => saveEmbeddings(pool, vectorFile),
        })
      ).embedded;
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      log(`embedding paused (${(error as Error).message}); retrying in 65 s`);
      await new Promise((res) => setTimeout(res, 65_000));
    }
  }
  if (embedded > 0) log(`embedded ${embedded} catalog items`);
  await saveEmbeddings(pool, vectorFile);
}
