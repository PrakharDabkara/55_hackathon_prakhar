import type { Queryable } from '../../db/queryable.js';

export interface ItemRow {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string;
  category: string;
  sim?: number;
  term?: string;
}

export interface CachedAnswer {
  itemId: string | null;
  question: string | null;
  optionIds: string[] | null;
}

export async function readCache(db: Queryable, text: string): Promise<CachedAnswer | null> {
  const { rows } = await db.query<{
    item_id: string | null;
    question: string | null;
    options: string[] | null;
  }>(`SELECT item_id, question, options FROM query_cache WHERE normalised = $1`, [text]);
  const row = rows[0];
  return row ? { itemId: row.item_id, question: row.question, optionIds: row.options } : null;
}

/** Remembers an answer from the embedding or LLM step, so the same query never costs a call again. */
export async function writeCache(
  db: Queryable,
  text: string,
  method: 'embedding' | 'llm',
  answer: CachedAnswer,
): Promise<void> {
  await db.query(
    `INSERT INTO query_cache (normalised, item_id, method, question, options)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (normalised) DO UPDATE
       SET item_id = EXCLUDED.item_id, method = EXCLUDED.method,
           question = EXCLUDED.question, options = EXCLUDED.options, created_at = now()`,
    [
      text,
      answer.itemId,
      method,
      answer.question,
      answer.optionIds ? JSON.stringify(answer.optionIds) : null,
    ],
  );
}

/** Pairs the LLM resolved, for a person to review later. Never added to the catalog automatically. */
export async function suggestSynonym(db: Queryable, term: string, itemId: string): Promise<void> {
  await db.query(
    `INSERT INTO suggested_synonyms (term, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [term, itemId],
  );
}

export async function itemsByIds(db: Queryable, ids: string[]): Promise<ItemRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<ItemRow>(
    `SELECT id, slug, name_en, name_hi, category FROM items WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export const hasEmbeddings = async (db: Queryable): Promise<boolean> =>
  ((await db.query(`SELECT 1 FROM items WHERE embedding IS NOT NULL LIMIT 1`)).rowCount ?? 0) > 0;

/** The 5 items closest to the query vector by cosine similarity (1 = identical direction). */
export async function nearestItems(db: Queryable, vector: number[], limit = 5): Promise<ItemRow[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT id, slug, name_en, name_hi, category, 1 - (embedding <=> $1::vector) AS sim
       FROM items WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector LIMIT $2`,
    [`[${vector.join(',')}]`, limit],
  );
  return rows;
}
