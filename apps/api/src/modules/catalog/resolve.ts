import type { Queryable } from '../../db/queryable.js';
import { normaliseQuery, type Quantity } from './normalise.js';

export interface CatalogItem {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string;
  category: string;
}

export type MatchedBy = 'synonym' | 'trigram';

export interface Resolution {
  normalised: string;
  quantity?: Quantity;
  item: CatalogItem | null;
  matchedBy: MatchedBy | null;
  /** 1 for an exact synonym, the trigram similarity for a fuzzy match, 0 when unresolved. */
  similarity: number;
}

interface ItemRow {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string;
  category: string;
  sim?: number;
}

const toItem = (r: ItemRow): CatalogItem => ({
  id: r.id,
  slug: r.slug,
  nameEn: r.name_en,
  nameHi: r.name_hi,
  category: r.category,
});

/**
 * Text → catalog item, cheapest path first: exact synonym, then trigram similarity at or above
 * `threshold` (at least 0.3). Anything else is unresolved; Day 9 adds embeddings and an LLM for it.
 * Every call writes a search_queries row; unresolved rows (item_id NULL) become the Day 9 eval set.
 */
export async function resolveItem(
  db: Queryable,
  raw: string,
  opts: { userId?: string | null; threshold: number },
): Promise<Resolution> {
  const { text, quantity } = normaliseQuery(raw);
  let item: CatalogItem | null = null;
  let matchedBy: MatchedBy | null = null;
  let similarity = 0;

  if (text) {
    const exact = await db.query<ItemRow>(
      `SELECT i.id, i.slug, i.name_en, i.name_hi, i.category
         FROM item_synonyms s JOIN items i ON i.id = s.item_id
        WHERE s.term = $1`,
      [text],
    );
    if (exact.rows[0]) {
      item = toItem(exact.rows[0]);
      matchedBy = 'synonym';
      similarity = 1;
    } else {
      // `%` lets the GIN index prefilter (at pg_trgm's default 0.3); `similarity` applies our threshold.
      const fuzzy = await db.query<ItemRow>(
        `SELECT i.id, i.slug, i.name_en, i.name_hi, i.category, similarity(s.term, $1) AS sim
           FROM item_synonyms s JOIN items i ON i.id = s.item_id
          WHERE s.term % $1 AND similarity(s.term, $1) >= $2
          ORDER BY sim DESC, s.term
          LIMIT 1`,
        [text, opts.threshold],
      );
      const row = fuzzy.rows[0];
      if (row) {
        item = toItem(row);
        matchedBy = 'trigram';
        similarity = row.sim ?? 0;
      }
    }
  }

  await db.query(
    `INSERT INTO search_queries (user_id, raw_text, normalised, item_id, matched_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [opts.userId ?? null, raw, text, item?.id ?? null, matchedBy],
  );

  return { normalised: text, ...(quantity && { quantity }), item, matchedBy, similarity };
}
