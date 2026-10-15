import type { Pool } from 'pg';

export const DIM = 768;

/** A unit vector built from weights on a few axes: the cosine between two is easy to reason about. */
export function vec(weights: Record<number, number>): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const [axis, w] of Object.entries(weights)) v[Number(axis)] = w;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

/** Gives items stored embeddings by slug (what `ai:embed-catalog` would have written). */
export async function setEmbeddings(pool: Pool, bySlug: Record<string, number[]>): Promise<void> {
  for (const [slug, v] of Object.entries(bySlug)) {
    await pool.query(
      `UPDATE items SET embedding = $2::vector, embedding_source_hash = 'test' WHERE slug = $1`,
      [slug, `[${v.join(',')}]`],
    );
  }
}
