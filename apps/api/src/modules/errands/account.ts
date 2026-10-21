import type { Queryable } from '../../db/queryable.js';

/** An errand the agent is still working on or waiting on an answer for. */
export async function hasLiveErrand(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM errands
      WHERE user_id = $1 AND state IN ('PLANNING', 'WAITING_FOR_SHOPS', 'NEEDS_INPUT') LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
