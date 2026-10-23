import type { Queryable } from '../../db/queryable.js';

/** A ping waiting at a simulated shop, with what the shop needs to decide (ADR-0062). */
export interface SimulatedPing {
  pingId: string;
  requestId: string;
  shopId: string;
  ownerUserId: string;
  shopCategories: string[];
  category: string;
  itemCategories: string[];
  refPricePaise: number | null;
  wantsDelivery: boolean;
  canDeliver: boolean;
  /** Milliseconds until the request ends. */
  remainingMs: number;
}

const MAX_TASKS = 200;

/**
 * The open pings of simulated shops (is_simulated, and only those) whose request is still live:
 * all of them, or just these ids. Same facts the admin stream carries, read from the database, so
 * a ping missed while the instance slept is found again. Never says who asked or where.
 */
export async function findSimulatedPings(db: Queryable, ids?: string[]): Promise<SimulatedPing[]> {
  const { rows } = await db.query<{
    id: string;
    request_id: string;
    shop_id: string;
    owner_user_id: string;
    shop_categories: string[];
    category: string;
    item_categories: string[];
    ref_price_paise: number | null;
    wants_delivery: boolean;
    can_deliver: boolean;
    remaining_ms: number;
  }>(
    `SELECT p.id, p.request_id, p.shop_id, s.owner_user_id, s.categories AS shop_categories,
            i.category, i.categories AS item_categories, i.ref_price_paise,
            r.wants_delivery,
            (s.delivery_max_km IS NULL
               OR ST_Distance(s.location, r.location) <= s.delivery_max_km * 1000) AS can_deliver,
            floor(extract(epoch FROM (r.expires_at - now())) * 1000)::int AS remaining_ms
       FROM pings p
       JOIN shops s ON s.id = p.shop_id
       JOIN requests r ON r.id = p.request_id
       JOIN items i ON i.id = p.item_id
      WHERE s.is_simulated AND s.owner_user_id IS NOT NULL AND p.state = 'SENT'
        AND r.state IN ('PINGING', 'ANSWERED') AND r.expires_at > now()
        AND ($1::uuid[] IS NULL OR p.id = ANY($1::uuid[]))
      ORDER BY p.sent_at
      LIMIT ${MAX_TASKS}`,
    [ids ?? null],
  );
  return rows.map((r) => ({
    pingId: r.id,
    requestId: r.request_id,
    shopId: r.shop_id,
    ownerUserId: r.owner_user_id,
    shopCategories: r.shop_categories,
    category: r.category,
    itemCategories: r.item_categories,
    refPricePaise: r.ref_price_paise,
    wantsDelivery: r.wants_delivery,
    canDeliver: r.can_deliver,
    remainingMs: r.remaining_ms,
  }));
}
