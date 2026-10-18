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
 * The catalog items whose vector is missing or was made from other text or another model. Customer-made
 * items (source 'user') are never embedded (ADR-0028): trigram finds them, and it saves quota.
 */
async function outstanding(db: Queryable, ai: Pick<AiContext, 'client'>) {
  const { rows } = await db.query<Row>(
    `SELECT i.id, i.name_en, i.name_hi, i.embedding_source_hash AS hash,
            coalesce(array_agg(s.term ORDER BY s.term) FILTER (WHERE s.term IS NOT NULL), '{}') AS terms
       FROM items i LEFT JOIN item_synonyms s ON s.item_id = i.id
      WHERE i.source = 'catalog'
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
  return { total: rows.length, work };
}

/** How many catalog items still need an embedding: what a deploy reports when embedding fails. */
export async function countPendingEmbeddings(
  db: Queryable,
  ai: Pick<AiContext, 'client'>,
): Promise<number> {
  return (await outstanding(db, ai)).work.length;
}

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
  const { total, work } = await outstanding(db, ai);
  const rows = { length: total };

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

export interface SafeEmbedResult {
  ok: boolean;
  /** Items embedded by this run. */
  embedded: number;
  /** Catalog items still without an up-to-date embedding when the run ended. */
  pending: number;
  /** Why it stopped, or null when it finished. */
  reason: string | null;
}

/**
 * The deploy's way of embedding (ADR-0021): never throws. A quota, a 503 or a timeout ends the run
 * with a count of the items still waiting; the batches already stored stay, and the next deploy's
 * per-item hash picks up the rest. Query resolution carries on without those items' embeddings.
 */
export async function embedCatalogSafely(
  db: Queryable,
  ai: AiContext,
  options: Parameters<typeof embedCatalog>[2] = {},
): Promise<SafeEmbedResult> {
  let before = 0;
  try {
    before = await countPendingEmbeddings(db, ai);
    const result = await embedCatalog(db, ai, options);
    return { ok: true, embedded: result.embedded, pending: 0, reason: null };
  } catch (error) {
    const reason = (error as Error).message.slice(0, 200);
    try {
      const pending = await countPendingEmbeddings(db, ai);
      return { ok: false, embedded: Math.max(0, before - pending), pending, reason };
    } catch {
      // The database itself is out of reach: say so, and count everything as waiting.
      return { ok: false, embedded: 0, pending: before, reason };
    }
  }
}

/** The text for the job summary: plain, and says what happens next. */
export function formatEmbedSummary(result: SafeEmbedResult): string {
  if (result.ok) {
    return `### Catalog embeddings\n\nEmbedded ${result.embedded} item${result.embedded === 1 ? '' : 's'}; nothing left to do.\n`;
  }
  return [
    '### ⚠️ Catalog embeddings not finished',
    '',
    `**${result.pending} catalog item${result.pending === 1 ? ' is' : 's are'} still un-embedded.** ${result.embedded} were embedded before it stopped (${result.reason ?? 'unknown reason'}).`,
    '',
    'The deploy still ran. Search works without those embeddings (dictionary, trigram and the model still answer); only the "closest meaning" step skips those items. The next deploy embeds exactly the items that are missing, so nothing needs doing by hand.',
    '',
  ].join('\n');
}
