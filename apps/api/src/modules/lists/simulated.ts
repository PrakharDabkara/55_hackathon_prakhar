import type { Queryable } from '../../db/queryable.js';

/** A parchi waiting at a simulated shop, with what the shop needs to decide (ADR-0062). */
export interface SimulatedParchi {
  listPingId: string;
  listId: string;
  shopId: string;
  ownerUserId: string;
  shopCategories: string[];
  wantsDelivery: boolean;
  canDeliver: boolean;
  /** Milliseconds until the list ends. */
  remainingMs: number;
  lines: {
    lineId: string;
    name: string;
    category: string | null;
    itemCategories: string[];
    refPricePaise: number | null;
    other: boolean;
  }[];
}

/** The most one call returns: the autopilot works in small batches. */
const MAX_TASKS = 100;

/**
 * The open parchis of simulated shops (is_simulated, and only those) whose list is still open: all
 * of them, or just these ids. Never says who asked or where.
 */
export async function findSimulatedParchis(
  db: Queryable,
  ids?: string[],
  limit = MAX_TASKS,
): Promise<SimulatedParchi[]> {
  const pings = await db.query<{
    id: string;
    list_id: string;
    shop_id: string;
    owner_user_id: string;
    shop_categories: string[];
    wants_delivery: boolean;
    can_deliver: boolean;
    remaining_ms: number;
  }>(
    `SELECT lp.id, lp.list_id, lp.shop_id, s.owner_user_id, s.categories AS shop_categories,
            l.wants_delivery,
            (s.delivery_max_km IS NULL
               OR ST_Distance(s.location, l.location) <= s.delivery_max_km * 1000) AS can_deliver,
            floor(extract(epoch FROM (l.expires_at - now())) * 1000)::int AS remaining_ms
       FROM list_pings lp
       JOIN shops s ON s.id = lp.shop_id
       JOIN shopping_lists l ON l.id = lp.list_id
      WHERE s.is_simulated AND s.owner_user_id IS NOT NULL AND lp.state = 'SENT'
        AND l.state = 'OPEN' AND l.expires_at > now()
        AND ($1::uuid[] IS NULL OR lp.id = ANY($1::uuid[]))
      ORDER BY lp.sent_at
      LIMIT $2`,
    [ids ?? null, Math.min(limit, MAX_TASKS)],
  );
  if (pings.rows.length === 0) return [];
  const lines = await db.query<{
    list_ping_id: string;
    line_id: string;
    text: string;
    status: string;
    category: string | null;
    categories: string[] | null;
    ref_price_paise: number | null;
  }>(
    `SELECT lpl.list_ping_id, ll.id AS line_id, ll.text, ll.status,
            i.category, i.categories, i.ref_price_paise
       FROM list_ping_lines lpl
       JOIN list_lines ll ON ll.id = lpl.line_id
       LEFT JOIN items i ON i.id = ll.item_id
      WHERE lpl.list_ping_id = ANY($1::uuid[])
      ORDER BY ll.position`,
    [pings.rows.map((p) => p.id)],
  );
  return pings.rows.map((p) => ({
    listPingId: p.id,
    listId: p.list_id,
    shopId: p.shop_id,
    ownerUserId: p.owner_user_id,
    shopCategories: p.shop_categories,
    wantsDelivery: p.wants_delivery,
    canDeliver: p.can_deliver,
    remainingMs: p.remaining_ms,
    lines: lines.rows
      .filter((l) => l.list_ping_id === p.id)
      .map((l) => ({
        lineId: l.line_id,
        name: l.text,
        category: l.category,
        itemCategories: l.categories ?? [],
        refPricePaise: l.ref_price_paise,
        other: l.status === 'other',
      })),
  }));
}
