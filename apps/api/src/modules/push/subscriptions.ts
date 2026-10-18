import type { Queryable } from '../../db/queryable.js';

export interface NewSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface StoredSubscription extends NewSubscription {
  id: string;
  userId: string;
}

/** The most browsers one person can have on; a new one pushes the oldest off. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Remembers a browser for a user. The same endpoint twice is one row with the newest keys, and a
 * browser that someone else logs in on moves to them. Returns the row id.
 */
export async function saveSubscription(
  db: Queryable,
  userId: string,
  sub: NewSubscription,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
     RETURNING id`,
    [userId, sub.endpoint, sub.p256dh, sub.auth],
  );
  await db.query(
    `DELETE FROM push_subscriptions
      WHERE user_id = $1
        AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = $1
                        ORDER BY created_at DESC, id LIMIT $2)`,
    [userId, MAX_SUBSCRIPTIONS_PER_USER],
  );
  return (rows[0] as { id: string }).id;
}

/** Removes one browser of this user; someone else's, or an unknown one, is simply not found. */
export async function removeSubscriptionOf(
  db: Queryable,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [
    userId,
    endpoint,
  ]);
}

export async function removeSubscription(db: Queryable, id: string): Promise<void> {
  await db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [id]);
}

export async function findSubscription(
  db: Queryable,
  id: string,
): Promise<StoredSubscription | null> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(`SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE id = $1`, [id]);
  const r = rows[0];
  return r
    ? { id: r.id, userId: r.user_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }
    : null;
}

/** The ids of a user's browsers, oldest first. Nothing secret leaves the database here. */
export async function listSubscriptionIds(db: Queryable, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((r) => r.id);
}

export async function markSubscriptionSuccess(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1`, [id]);
}
