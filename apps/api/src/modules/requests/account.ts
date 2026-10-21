import type { Queryable } from '../../db/queryable.js';

/** A search still asking shops, or still showing answers, that has not run out of time. */
export async function hasLiveRequest(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM requests
      WHERE user_id = $1 AND state IN ('OPEN', 'PINGING', 'ANSWERED') AND expires_at > now()
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
