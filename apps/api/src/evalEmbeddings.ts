import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Queryable } from './db/queryable.js';

/**
 * Writes every stored catalog vector to the cache file. Called after each embedded batch, so a run
 * that is killed or times out has still saved what it paid for, and the next run does not embed the
 * catalog again.
 */
export async function saveEmbeddings(db: Queryable, vectorFile: string): Promise<void> {
  const stored = await db.query<{ slug: string; hash: string; vector: string }>(
    `SELECT slug, embedding_source_hash AS hash, embedding::text AS vector
       FROM items WHERE embedding IS NOT NULL`,
  );
  mkdirSync(path.dirname(vectorFile), { recursive: true });
  writeFileSync(vectorFile, JSON.stringify(stored.rows));
}
