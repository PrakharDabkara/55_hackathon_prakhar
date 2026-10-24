import { GENERAL_STORE_ALSO_TAKES } from '@askbuy/shared';
import type { Queryable } from '../../db/queryable.js';
import type { WindowDays } from './window.js';

/** Different customers it takes before the area's demand for an item is shown (ADR-0035). */
export const MIN_AREA_CUSTOMERS = 3;
/** "Within its area": requests made this close to the shop. */
export const AREA_RADIUS_M = 3000;
/** The lists stay short enough for a phone. */
const MAX_ROWS = 10;
/** Shops keep Indian hours, so "today" starts at midnight there. */
const TIME_ZONE = 'Asia/Kolkata';

export interface ItemNames {
  nameEn: string;
  nameHi: string;
}

export interface ShopDemand {
  /** The window the numbers cover: today (1) or today and the six days before (7). */
  days: WindowDays;
  /** The names stay as they were; they cover the whole window. */
  today: { received: number; answered: number; yes: number };
  /** Seconds between sending and the shop's answer (yes or no, not late), averaged; null if none. */
  avgReplySeconds: number | null;
  /** Asked of this shop today and said no to, or never answered: item and how many times. */
  asked: { item: ItemNames; count: number }[];
  /** Asked near this shop today in its categories, only with MIN_AREA_CUSTOMERS or more customers. */
  nearby: { item: ItemNames; customers: number }[];
}

interface NamedRow {
  name_en: string;
  name_hi: string;
}
const names = (r: NamedRow): ItemNames => ({ nameEn: r.name_en, nameHi: r.name_hi });

/**
 * "Aaj ki maang", worked out from the database alone. Nothing here carries a customer: the first
 * two parts count this shop's own pings, the third counts distinct customers inside the query and
 * returns only the item and that number, and only when it reaches the minimum (a count of one or
 * two could point at a person).
 */
export async function shopDemand(
  db: Queryable,
  shopId: string,
  days: WindowDays = 1,
): Promise<ShopDemand> {
  // Midnight in the shop's time zone, `days - 1` days back, as an instant. `days` is 1 or 7 (a
  // number checked by parseDays), so it is safe to write into the text.
  const today = `((date_trunc('day', now() AT TIME ZONE '${TIME_ZONE}') - interval '${days - 1} days') AT TIME ZONE '${TIME_ZONE}')`;

  const counts = await db.query<{
    received: number;
    answered: number;
    yes: number;
    avg_reply: number | null;
  }>(
    `SELECT count(*)::int AS received,
            count(*) FILTER (WHERE state IN ('YES', 'NO'))::int AS answered,
            count(*) FILTER (WHERE state = 'YES')::int AS yes,
            (avg(extract(epoch FROM answered_at - sent_at))
               FILTER (WHERE state IN ('YES', 'NO') AND NOT late))::float8 AS avg_reply
       FROM pings
      WHERE shop_id = $1 AND created_at >= ${today} AND state <> 'QUEUED'`,
    [shopId],
  );
  const asked = await db.query<NamedRow & { count: number }>(
    `SELECT i.name_en, i.name_hi, count(*)::int AS count
       FROM pings p JOIN items i ON i.id = p.item_id
      WHERE p.shop_id = $1 AND p.created_at >= ${today} AND p.state IN ('NO', 'NO_REPLY')
      GROUP BY i.id ORDER BY count DESC, i.name_en LIMIT $2`,
    [shopId, MAX_ROWS],
  );
  const nearby = await db.query<NamedRow & { customers: number }>(
    `SELECT i.name_en, i.name_hi, count(DISTINCT r.user_id)::int AS customers
       FROM shops s
       JOIN requests r ON r.created_at >= ${today}
                      AND ST_DWithin(r.location, s.location, $2)
       JOIN items i ON i.id = r.item_id
        AND i.category = ANY (s.categories::text[] || CASE
              WHEN 'general_store' = ANY(s.categories) THEN $5::text[] ELSE '{}'::text[] END)
      WHERE s.id = $1
      GROUP BY i.id
     HAVING count(DISTINCT r.user_id) >= $3
      ORDER BY customers DESC, i.name_en LIMIT $4`,
    [shopId, AREA_RADIUS_M, MIN_AREA_CUSTOMERS, MAX_ROWS, [...GENERAL_STORE_ALSO_TAKES]],
  );

  const row = counts.rows[0] ?? { received: 0, answered: 0, yes: 0, avg_reply: null };
  return {
    days,
    today: { received: row.received, answered: row.answered, yes: row.yes },
    avgReplySeconds: row.avg_reply === null ? null : Math.round(row.avg_reply),
    asked: asked.rows.map((r) => ({ item: names(r), count: r.count })),
    nearby: nearby.rows.map((r) => ({ item: names(r), customers: r.customers })),
  };
}
