import type { Queryable } from '../../db/queryable.js';

/** How many sent lists are live: each counts as one of the customer's searches. */
export async function countLiveLists(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM shopping_lists
      WHERE user_id = $1 AND state IN ('OPEN', 'FULL') AND expires_at > now()`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export interface ActiveList {
  id: string;
  lineCount: number;
  /** The first lines as the customer wrote them, for the card. */
  lines: string[];
  /** Shops that answered the list. */
  replies: number;
  createdAt: Date;
  expiresAt: Date;
}

/** The customer's live lists, newest first: cards on the home screen. */
export async function listActiveLists(db: Queryable, userId: string): Promise<ActiveList[]> {
  const { rows } = await db.query<{
    id: string;
    texts: string[];
    replies: number;
    sent_at: Date;
    expires_at: Date;
  }>(
    `SELECT l.id, l.sent_at, l.expires_at,
            (SELECT coalesce(array_agg(text ORDER BY position), '{}') FROM list_lines WHERE list_id = l.id
               AND status IN ('item', 'other')) AS texts,
            (SELECT count(*)::int FROM list_pings WHERE list_id = l.id AND state = 'ANSWERED') AS replies
       FROM shopping_lists l
      WHERE l.user_id = $1 AND l.state IN ('OPEN', 'FULL') AND l.expires_at > now()
      ORDER BY l.sent_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    lineCount: r.texts.length,
    lines: r.texts.slice(0, 3),
    replies: r.replies,
    createdAt: r.sent_at,
    expiresAt: r.expires_at,
  }));
}

/** A sent list that has not ended and has not run out of time (a draft is nobody's business). */
export async function hasLiveList(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM shopping_lists
      WHERE user_id = $1 AND state IN ('OPEN', 'FULL') AND expires_at > now() LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
