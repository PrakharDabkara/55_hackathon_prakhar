import type { Queryable } from '../../db/queryable.js';

/** Item ids by slug; a slug the catalog does not have is simply missing from the map. */
export async function findItemIdsBySlugs(
  db: Queryable,
  slugs: string[],
): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM items WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  return new Map(rows.map((r) => [r.slug, r.id]));
}
