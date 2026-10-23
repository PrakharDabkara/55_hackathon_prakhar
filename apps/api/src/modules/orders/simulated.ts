import type { Queryable } from '../../db/queryable.js';

/** An order at a simulated shop that is waiting for the shop to move it (ADR-0062). */
export interface SimulatedOrder {
  orderId: string;
  shopId: string;
  ownerUserId: string;
  state: 'REQUESTED' | 'ACCEPTED';
  fulfilment: 'delivery' | 'pickup';
  /** Milliseconds until a REQUESTED order expires; an accepted one has no such limit. */
  remainingMs: number | null;
}

const MAX_TASKS = 200;
/** An accepted order untouched for longer than this is left to its own sweeps. */
const ACCEPTED_MAX_AGE = '3 hours';

/**
 * Orders at simulated shops (is_simulated, and only those) that still need the shop: a new one to
 * accept, or an accepted one to set out or make ready. All of them, or just these ids.
 */
export async function findSimulatedOrders(
  db: Queryable,
  ids?: string[],
): Promise<SimulatedOrder[]> {
  const { rows } = await db.query<{
    id: string;
    shop_id: string;
    owner_user_id: string;
    state: 'REQUESTED' | 'ACCEPTED';
    fulfilment: 'delivery' | 'pickup';
    remaining_ms: number | null;
  }>(
    `SELECT o.id, o.shop_id, s.owner_user_id, o.state, o.fulfilment,
            CASE WHEN o.state = 'REQUESTED'
                 THEN floor(extract(epoch FROM (o.expires_at - now())) * 1000)::int END AS remaining_ms
       FROM delivery_orders o JOIN shops s ON s.id = o.shop_id
      WHERE s.is_simulated AND s.owner_user_id IS NOT NULL
        AND ((o.state = 'REQUESTED' AND o.expires_at > now())
             OR (o.state = 'ACCEPTED' AND o.updated_at > now() - interval '${ACCEPTED_MAX_AGE}'))
        AND ($1::uuid[] IS NULL OR o.id = ANY($1::uuid[]))
      ORDER BY o.created_at
      LIMIT ${MAX_TASKS}`,
    [ids ?? null],
  );
  return rows.map((r) => ({
    orderId: r.id,
    shopId: r.shop_id,
    ownerUserId: r.owner_user_id,
    state: r.state,
    fulfilment: r.fulfilment,
    remainingMs: r.remaining_ms,
  }));
}
