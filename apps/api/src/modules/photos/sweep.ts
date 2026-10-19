import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { storedBytes } from './service.js';

/** A photo goes this long after its request expired (ADR-0030). */
export const KEEP_AFTER_EXPIRY_DAYS = 7;
/** A photo nobody attached to a request or an answer is dropped after this long. */
export const KEEP_UNATTACHED_HOURS = 24;

/**
 * Deletes the photos of requests that expired more than 7 days ago (customer photos and the shops'
 * answer photos), and photos never attached to anything after a day. Logs the total still stored.
 */
export async function sweepPhotos(
  ctx: { db: Queryable; logger: Logger },
  now: Date,
): Promise<{ deleted: number; totalBytes: number }> {
  const { rows } = await ctx.db.query<{ n: number }>(
    `WITH gone AS (
       DELETE FROM photos p
        WHERE (p.request_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM requests r
                  WHERE r.id = p.request_id AND r.expires_at < $1::timestamptz - make_interval(days => $2)))
           OR (p.ping_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM pings g JOIN requests r ON r.id = g.request_id
                  WHERE g.id = p.ping_id AND r.expires_at < $1::timestamptz - make_interval(days => $2)))
           OR (p.request_id IS NULL AND p.ping_id IS NULL AND p.role <> 'logo'
               AND p.created_at < $1::timestamptz - make_interval(hours => $3))
        RETURNING 1)
     SELECT count(*)::int AS n FROM gone`,
    [now, KEEP_AFTER_EXPIRY_DAYS, KEEP_UNATTACHED_HOURS],
  );
  const deleted = rows[0]?.n ?? 0;
  const totalBytes = await storedBytes(ctx.db);
  ctx.logger.info({ event: 'photos_swept', deleted, totalBytes }, 'photo sweep');
  return { deleted, totalBytes };
}
