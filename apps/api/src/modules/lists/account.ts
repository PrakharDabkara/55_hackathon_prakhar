import type { Queryable } from '../../db/queryable.js';

/** A sent list that has not ended and has not run out of time (a draft is nobody's business). */
export async function hasLiveList(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM shopping_lists
      WHERE user_id = $1 AND state IN ('OPEN', 'FULL') AND expires_at > now() LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
