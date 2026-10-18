import type { Queryable } from '../../db/queryable.js';

/** New items one errand may add, and one user may add in a day (ADR-0029). */
export const MAX_NEW_ITEMS_PER_ERRAND = 5;
export const MAX_NEW_ITEMS_PER_USER_PER_DAY = 10;

export type LimitScope = 'errand' | 'day';

/** Which limit the next new item would break, or null. Reused items do not count. */
export async function overNewItemLimit(
  db: Queryable,
  { userId, errandId }: { userId: string; errandId?: string | null | undefined },
): Promise<LimitScope | null> {
  const { rows } = await db.query<{ errand: number; day: number }>(
    `SELECT (SELECT count(*) FROM new_item_attempts WHERE errand_id = $2::uuid)::int AS errand,
            (SELECT count(*) FROM new_item_attempts
              WHERE user_id = $1 AND created_at > now() - interval '24 hours')::int AS day`,
    [userId, errandId ?? null],
  );
  const counts = rows[0] as { errand: number; day: number };
  if (errandId && counts.errand >= MAX_NEW_ITEMS_PER_ERRAND) return 'errand';
  if (counts.day >= MAX_NEW_ITEMS_PER_USER_PER_DAY) return 'day';
  return null;
}

/** Records that an item was created or blocked: the fact and the rule, never the text. */
export async function recordNewItemAttempt(
  db: Queryable,
  attempt: {
    userId: string;
    errandId?: string | null | undefined;
    outcome: 'created' | 'blocked';
    rule?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO new_item_attempts (user_id, errand_id, outcome, rule) VALUES ($1, $2, $3, $4)`,
    [attempt.userId, attempt.errandId ?? null, attempt.outcome, attempt.rule ?? null],
  );
}
