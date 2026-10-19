import type { Queryable } from '../../db/queryable.js';

export interface ItemRow {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string;
  category: string;
  /** Every kind of shop that carries the item, the primary (`category`) first. */
  categories: string[];
  /** A customer-made item no shop has confirmed yet. */
  unverified: boolean;
  sim?: number;
  term?: string;
}

export interface CachedAnswer {
  itemId: string | null;
  question: string | null;
  optionIds: string[] | null;
}

/** An answer for this text, if one was made for this catalog file and has not expired. */
export async function readCache(
  db: Queryable,
  text: string,
  catalogVersion: string,
): Promise<CachedAnswer | null> {
  const { rows } = await db.query<{
    item_id: string | null;
    question: string | null;
    options: string[] | null;
  }>(
    `SELECT item_id, question, options FROM query_cache
      WHERE normalised = $1 AND catalog_version = $2 AND expires_at > now()`,
    [text, catalogVersion],
  );
  const row = rows[0];
  return row ? { itemId: row.item_id, question: row.question, optionIds: row.options } : null;
}

/** Positive answers (an item, or a question to ask) are trusted for 30 days; "nothing fits" for 1 day. */
const POSITIVE_TTL = '30 days';
const NEGATIVE_TTL = '1 day';

/**
 * Remembers an answer from the embedding or LLM step, so the same query never costs a call again.
 * Trigram and synonym answers are never written: they are free to recompute.
 */
export async function writeCache(
  db: Queryable,
  text: string,
  method: 'embedding' | 'llm',
  answer: CachedAnswer,
  catalogVersion: string,
): Promise<void> {
  const positive = Boolean(answer.itemId || answer.optionIds);
  await db.query(
    `INSERT INTO query_cache (normalised, item_id, method, question, options, catalog_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + $7::interval)
     ON CONFLICT (normalised) DO UPDATE
       SET item_id = EXCLUDED.item_id, method = EXCLUDED.method,
           question = EXCLUDED.question, options = EXCLUDED.options, created_at = now(),
           catalog_version = EXCLUDED.catalog_version, expires_at = EXCLUDED.expires_at`,
    [
      text,
      answer.itemId,
      method,
      answer.question,
      answer.optionIds ? JSON.stringify(answer.optionIds) : null,
      catalogVersion,
      positive ? POSITIVE_TTL : NEGATIVE_TTL,
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
    `SELECT id, slug, name_en, name_hi, category, categories, unverified FROM items WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** The items with these slugs, in the order asked; a slug nobody has is left out. */
export async function itemsBySlugs(db: Queryable, slugs: string[]): Promise<ItemRow[]> {
  if (slugs.length === 0) return [];
  const { rows } = await db.query<ItemRow>(
    `SELECT id, slug, name_en, name_hi, category, categories, unverified FROM items WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs.flatMap((slug) => bySlug.get(slug) ?? []);
}

export const hasEmbeddings = async (db: Queryable): Promise<boolean> =>
  ((await db.query(`SELECT 1 FROM items WHERE embedding IS NOT NULL LIMIT 1`)).rowCount ?? 0) > 0;

/** The 5 items closest to the query vector by cosine similarity (1 = identical direction). */
export async function nearestItems(db: Queryable, vector: number[], limit = 5): Promise<ItemRow[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT id, slug, name_en, name_hi, category, categories, unverified, 1 - (embedding <=> $1::vector) AS sim
       FROM items WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector LIMIT $2`,
    [`[${vector.join(',')}]`, limit],
  );
  return rows;
}

/** The item a generic word defaults to ("pen" → ball pen), from the catalog file. */
export async function defaultItem(db: Queryable, text: string): Promise<ItemRow | null> {
  const { rows } = await db.query<ItemRow>(
    `SELECT i.id, i.slug, i.name_en, i.name_hi, i.category, i.categories, i.unverified
       FROM item_defaults d JOIN items i ON i.id = d.item_id WHERE d.term = $1`,
    [text],
  );
  return rows[0] ?? null;
}

/** A query word counts as a real word if it looks like part of some catalog term. */
const WORD_SIMILARITY = 0.4;
/** Words shorter than this are numbers, units and particles: they say nothing about being gibberish. */
const MIN_WORD_LENGTH = 3;

/**
 * How many of the query's words (3+ characters) resemble something in the catalog. "xyzzy plugh"
 * has two words and one of them resembles "plug"; "bottle brsh" has two and both do.
 */
export async function wordSupport(
  db: Queryable,
  text: string,
): Promise<{ considered: number; similar: number }> {
  const words = [...new Set(text.split(' ').filter((w) => [...w].length >= MIN_WORD_LENGTH))];
  if (words.length === 0) return { considered: 0, similar: 0 };
  const { rows } = await db.query<{ similar: number }>(
    `SELECT count(*)::int AS similar
       FROM unnest($1::text[]) AS w(word)
      WHERE EXISTS (SELECT 1 FROM item_synonyms s WHERE word_similarity(w.word, s.term) >= $2)`,
    [words, WORD_SIMILARITY],
  );
  return { considered: words.length, similar: rows[0]?.similar ?? 0 };
}
