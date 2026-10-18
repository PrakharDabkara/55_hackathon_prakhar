import type { Queryable } from '../../db/queryable.js';

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
  today: { received: number; answered: number; yes: number };
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
export async function shopDemand(db: Queryable, shopId: string): Promise<ShopDemand> {
  // Midnight today in the shop's time zone, as an instant.
  const today = `(date_trunc('day', now() AT TIME ZONE '${TIME_ZONE}') AT TIME ZONE '${TIME_ZONE}')`;

  const counts = await db.query<{ received: number; answered: number; yes: number }>(
    `SELECT count(*)::int AS received,
            count(*) FILTER (WHERE state IN ('YES', 'NO'))::int AS answered,
            count(*) FILTER (WHERE state = 'YES')::int AS yes
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
       JOIN items i ON i.id = r.item_id AND i.category = ANY (s.categories)
      WHERE s.id = $1
      GROUP BY i.id
     HAVING count(DISTINCT r.user_id) >= $3
      ORDER BY customers DESC, i.name_en LIMIT $4`,
    [shopId, AREA_RADIUS_M, MIN_AREA_CUSTOMERS, MAX_ROWS],
  );

  const row = counts.rows[0] ?? { received: 0, answered: 0, yes: 0 };
  return {
    today: { received: row.received, answered: row.answered, yes: row.yes },
    asked: asked.rows.map((r) => ({ item: names(r), count: r.count })),
    nearby: nearby.rows.map((r) => ({ item: names(r), customers: r.customers })),
  };
}
