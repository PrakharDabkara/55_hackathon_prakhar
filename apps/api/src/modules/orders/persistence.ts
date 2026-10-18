import type { Queryable } from '../../db/queryable.js';
import { ORDER_STATES, orderTransition, type OrderEvent, type OrderState } from './stateMachine.js';
import type { OrderLine, OrderRecord } from './types.js';

interface Row {
  id: string;
  user_id: string;
  shop_id: string;
  shop_name: string;
  shop_owner_user_id: string | null;
  request_id: string | null;
  errand_id: string | null;
  state: OrderState;
  lines: OrderLine[];
  items_total_paise: number | null;
  unknown_price_count: number;
  fee_paise: number | null;
  fee_minutes: number | null;
  address_text: string;
  customer_first_name: string | null;
  lat: number;
  lng: number;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT o.id, o.user_id, o.shop_id, s.name AS shop_name, s.owner_user_id AS shop_owner_user_id,
       o.request_id, o.errand_id, o.state, o.lines, o.items_total_paise, o.unknown_price_count,
       o.fee_paise, o.fee_minutes, o.address_text, o.customer_first_name, o.lat, o.lng,
       o.expires_at, o.created_at, o.updated_at
  FROM delivery_orders o JOIN shops s ON s.id = o.shop_id`;

const toRecord = (r: Row): OrderRecord => ({
  id: r.id,
  userId: r.user_id,
  shopId: r.shop_id,
  shopName: r.shop_name,
  shopOwnerUserId: r.shop_owner_user_id,
  requestId: r.request_id,
  errandId: r.errand_id,
  state: r.state,
  lines: r.lines,
  itemsTotalPaise: r.items_total_paise,
  unknownPriceCount: r.unknown_price_count,
  feePaise: r.fee_paise,
  feeMinutes: r.fee_minutes,
  addressText: r.address_text,
  customerFirstName: r.customer_first_name,
  lat: r.lat,
  lng: r.lng,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewOrder {
  userId: string;
  shopId: string;
  requestId: string | null;
  errandId: string | null;
  lines: OrderLine[];
  itemsTotalPaise: number | null;
  unknownPriceCount: number;
  feePaise: number | null;
  feeMinutes: number | null;
  addressText: string;
  customerFirstName: string | null;
  lat: number;
  lng: number;
  expiryMinutes: number;
}

/** Inserts the order, or returns null if the customer already has an open one for this shop and source. */
export async function insertOrder(db: Queryable, o: NewOrder): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO delivery_orders
       (user_id, shop_id, request_id, errand_id, source_id, lines, items_total_paise,
        unknown_price_count, fee_paise, fee_minutes, address_text, customer_first_name, lat, lng,
        expires_at)
     VALUES ($1, $2, $3::uuid, $4::uuid, COALESCE($3::uuid, $4::uuid), $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13,
             now() + make_interval(mins => $14::int))
     ON CONFLICT (user_id, shop_id, source_id)
       WHERE state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY') DO NOTHING
     RETURNING id`,
    [
      o.userId,
      o.shopId,
      o.requestId,
      o.errandId,
      JSON.stringify(o.lines),
      o.itemsTotalPaise,
      o.unknownPriceCount,
      o.feePaise,
      o.feeMinutes,
      o.addressText,
      o.customerFirstName,
      o.lat,
      o.lng,
      o.expiryMinutes,
    ],
  );
  return rows[0]?.id ?? null;
}

export async function findOrder(db: Queryable, id: string): Promise<OrderRecord | null> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE o.id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** The customer's open order for this shop and source, if any. */
export async function findOpenOrder(
  db: Queryable,
  userId: string,
  shopId: string,
  sourceId: string,
): Promise<OrderRecord | null> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE o.user_id = $1 AND o.shop_id = $2 AND COALESCE(o.request_id, o.errand_id) = $3
        AND o.state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY')`,
    [userId, shopId, sourceId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listOrdersForSource(
  db: Queryable,
  userId: string,
  source: { requestId: string } | { errandId: string },
): Promise<OrderRecord[]> {
  const id = 'requestId' in source ? source.requestId : source.errandId;
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE o.user_id = $1 AND COALESCE(o.request_id, o.errand_id) = $2
      ORDER BY o.created_at DESC`,
    [userId, id],
  );
  return rows.map(toRecord);
}

/** The shop's orders: open ones, and finished ones from the last two hours. Newest first. */
export async function listOrdersForShop(
  db: Queryable,
  ownerUserId: string,
): Promise<OrderRecord[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE s.owner_user_id = $1
        AND (o.state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY')
             OR o.updated_at > now() - interval '2 hours')
      ORDER BY o.created_at DESC LIMIT 50`,
    [ownerUserId],
  );
  return rows.map(toRecord);
}

/** What the customer typed last time, so the next order is one tap. Theirs only. */
export async function lastAddress(
  db: Queryable,
  userId: string,
): Promise<{ addressText: string; customerName: string | null } | null> {
  const { rows } = await db.query<{ address_text: string; customer_first_name: string | null }>(
    `SELECT address_text, customer_first_name FROM delivery_orders
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  return row ? { addressText: row.address_text, customerName: row.customer_first_name } : null;
}

export type MoveResult =
  | { kind: 'applied'; order: OrderRecord; from: OrderState }
  /** The order was already where this event leads: a repeated tap. */
  | { kind: 'unchanged'; order: OrderRecord }
  | { kind: 'invalid'; order: OrderRecord }
  | { kind: 'not_found' };

/**
 * Moves an order by one event. The UPDATE is guarded (`WHERE state = from`), so of two taps at
 * once exactly one is applied; the other finds the state changed and is reported, not forced.
 */
export async function moveOrder(db: Queryable, id: string, event: OrderEvent): Promise<MoveResult> {
  const current = await findOrder(db, id);
  if (!current) return { kind: 'not_found' };
  const next = orderTransition(current.state, event);
  if (!next.ok) {
    // Already there (a double tap): the same event that led here is harmless.
    const repeated = ORDER_STATES.some((from) => {
      const t = orderTransition(from, event);
      return t.ok && t.to === current.state;
    });
    return repeated ? { kind: 'unchanged', order: current } : { kind: 'invalid', order: current };
  }
  const { rowCount } = await db.query(
    `UPDATE delivery_orders SET state = $3, updated_at = now() WHERE id = $1 AND state = $2`,
    [id, current.state, next.to],
  );
  const after = (await findOrder(db, id)) as OrderRecord;
  if (rowCount === 1) return { kind: 'applied', order: after, from: current.state };
  // Someone moved it first. If they moved it where we meant to, it is a repeat; else it is refused.
  return after.state === next.to
    ? { kind: 'unchanged', order: after }
    : { kind: 'invalid', order: after };
}

/** Ids of orders still waiting for a shop past their time. */
export async function findOverdueOrderIds(db: Queryable, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM delivery_orders WHERE state = 'REQUESTED' AND expires_at <= now()
      ORDER BY expires_at LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}
