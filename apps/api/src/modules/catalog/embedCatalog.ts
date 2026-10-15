import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { AiUnavailableError, type AiContext } from '../ai/index.js';

interface Row {
  id: string;
  name_en: string;
  name_hi: string;
  hash: string | null;
  terms: string[];
}

export interface EmbedResult {
  embedded: number;
  skipped: number;
}

/** What an item's vector is made from: its two names and its synonyms. Only catalog text, nothing else. */
const sourceText = (r: Row) =>
  [
    r.name_en,
    r.name_hi,
    ...r.terms.filter((t) => t !== r.name_en.toLowerCase() && t !== r.name_hi),
  ].join(' | ');

/**
 * Embeds the items whose source text (or embedding model) changed since their vector was made.
 * Batches calls and pauses between them to stay inside free-tier rate limits. Batches already
 * stored stay stored if a later one fails, so the next run carries on where this one stopped.
 */
export async function embedCatalog(
  db: Queryable,
  ai: AiContext,
  {
    batchSize = 50,
    pauseMs = 1000,
    logger,
  }: { batchSize?: number; pauseMs?: number; logger?: Logger } = {},
): Promise<EmbedResult> {
  const { rows } = await db.query<Row>(
    `SELECT i.id, i.name_en, i.name_hi, i.embedding_source_hash AS hash,
            coalesce(array_agg(s.term ORDER BY s.term) FILTER (WHERE s.term IS NOT NULL), '{}') AS terms
       FROM items i LEFT JOIN item_synonyms s ON s.item_id = i.id
      GROUP BY i.id ORDER BY i.slug`,
  );

  const model = ai.client.embedModel;
  const work = rows
    .map((r) => {
      const text = sourceText(r);
      return {
        id: r.id,
        text,
        hash: createHash('sha256').update(`${model}|${text}`).digest('hex'),
        old: r.hash,
      };
    })
    .filter((w) => w.hash !== w.old);

  for (let start = 0; start < work.length; start += batchSize) {
    const batch = work.slice(start, start + batchSize);
    let vectors: number[][];
    try {
      ({ vectors } = await ai.client.embed(
        batch.map((w) => w.text),
        'embed_catalog',
      ));
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        throw new Error(`embedding stopped after ${start} of ${work.length} items (${error.kind})`);
      }
      throw error;
    }
    await db.query(
      `UPDATE items i SET embedding = v.e::vector, embedding_source_hash = v.h
         FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, e, h)
        WHERE i.id = v.id::uuid`,
      [batch.map((w) => w.id), vectors.map((v) => `[${v.join(',')}]`), batch.map((w) => w.hash)],
    );
    logger?.info({ done: start + batch.length, of: work.length }, 'embedded catalog items');
    if (pauseMs > 0 && start + batchSize < work.length)
      await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { embedded: work.length, skipped: rows.length - work.length };
}
