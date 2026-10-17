import type { Queryable } from '../../db/queryable.js';

/**
 * Every normalised word that means each item: its names, its synonyms and the generic words it is
 * the usual choice for ("tea" → tea leaves). Used to tell whether what a customer said is what
 * they got.
 */
export async function termsOfItems(
  db: Queryable,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const terms = new Map<string, string[]>(itemIds.map((id) => [id, []]));
  if (itemIds.length === 0) return terms;
  const { rows } = await db.query<{ item_id: string; term: string }>(
    `SELECT item_id, term FROM item_synonyms WHERE item_id = ANY($1::uuid[])
     UNION
     SELECT item_id, term FROM item_defaults WHERE item_id = ANY($1::uuid[])`,
    [itemIds],
  );
  for (const r of rows) terms.get(r.item_id)?.push(r.term);
  return terms;
}
