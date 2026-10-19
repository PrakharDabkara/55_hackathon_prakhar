import type { Queryable } from '../../db/queryable.js';
import {
  ORDER_STATES,
  RECEIVE_WINDOW_HOURS,
  orderTransition,
  type OrderEvent,
  type OrderState,
} from './stateMachine.js';
import type { OrderLine, OrderRecord, ShopCancelReason } from './types.js';

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
  address_text: string | null;
  customer_first_name: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  out_for_delivery_at: Date | null;
  receive_by: Date | null;
  cancelled_by: 'customer' | 'shop' | null;
  cancel_reason: ShopCancelReason | null;
  cancel_text: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT o.id, o.user_id, o.shop_id, s.name AS shop_name, s.owner_user_id AS shop_owner_user_id,
       o.request_id, o.errand_id, o.state, o.lines, o.items_total_paise, o.unknown_price_count,
       o.fee_paise, o.fee_minutes, o.address_text, o.customer_first_name, o.lat, o.lng,
       o.note, o.out_for_delivery_at, o.receive_by, o.cancelled_by, o.cancel_reason, o.cancel_text,
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
  note: r.note,
  outForDeliveryAt: r.out_for_delivery_at,
  receiveBy: r.receive_by,
  cancelledBy: r.cancelled_by,
  cancelReason: r.cancel_reason,
  cancelText: r.cancel_text,
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
  note: string | null;
  /** ACCEPTED when the customer took a binding offer; otherwise the shop must accept in time. */
  state: 'REQUESTED' | 'ACCEPTED';
  expiryMinutes: number;
}

/** Inserts the order, or returns null if the customer already has an open one for this shop and source. */
export async function insertOrder(db: Queryable, o: NewOrder): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO delivery_orders
       (user_id, shop_id, request_id, errand_id, source_id, lines, items_total_paise,
        unknown_price_count, fee_paise, fee_minutes, address_text, customer_first_name, lat, lng,
        note, state, expires_at)
     VALUES ($1, $2, $3::uuid, $4::uuid, COALESCE($3::uuid, $4::uuid), $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, now() + make_interval(mins => $16::int))
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
      o.note,
      o.state,
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

const ACTIVE = `('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY')`;
const FINAL = `('DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED', 'NOT_CONFIRMED')`;

/** All the customer's orders: the open ones first, then the finished, each newest first. */
export async function listOrdersForUser(
  db: Queryable,
  userId: string,
  limit: number,
): Promise<OrderRecord[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE o.user_id = $1
      ORDER BY (o.state IN ${ACTIVE}) DESC, o.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toRecord);
}

/** The shop's orders: open ones first, then finished ones, each newest first. */
export async function listOrdersForShop(
  db: Queryable,
  ownerUserId: string,
  limit: number,
): Promise<OrderRecord[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE s.owner_user_id = $1
      ORDER BY (o.state IN ${ACTIVE}) DESC, o.created_at DESC LIMIT $2`,
    [ownerUserId, limit],
  );
  return rows.map(toRecord);
}

export interface SavedAddress {
  id: string;
  addressText: string;
  customerName: string | null;
}

/** What the customer chose to keep ("Is pate ko yaad rakhein"). Theirs only. */
export async function getSavedAddress(db: Queryable, userId: string): Promise<SavedAddress | null> {
  const { rows } = await db.query<{
    id: string;
    address_text: string;
    customer_first_name: string | null;
  }>(`SELECT id, address_text, customer_first_name FROM saved_addresses WHERE user_id = $1`, [
    userId,
  ]);
  const row = rows[0];
  return row
    ? { id: row.id, addressText: row.address_text, customerName: row.customer_first_name }
    : null;
}

/** The customer's saved address if this id is theirs and still there. */
export async function getSavedAddressById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<SavedAddress | null> {
  const saved = await getSavedAddress(db, userId);
  return saved?.id === id ? saved : null;
}

export async function saveAddress(
  db: Queryable,
  userId: string,
  addressText: string,
  firstName: string | null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO saved_addresses (user_id, address_text, customer_first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET address_text = EXCLUDED.address_text,
           customer_first_name = EXCLUDED.customer_first_name,
           updated_at = now()
     RETURNING id`,
    [userId, addressText, firstName],
  );
  return (rows[0] as { id: string }).id;
}

export async function forgetSavedAddress(db: Queryable, userId: string): Promise<void> {
  await db.query(`DELETE FROM saved_addresses WHERE user_id = $1`, [userId]);
}

/** How long a finished order keeps its address and pin (ADR-0033). */
export const ADDRESS_RETENTION_DAYS = 30;

/** Clears address and pin of orders that ended more than the retention ago. Returns how many. */
export async function clearOldAddresses(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE delivery_orders
        SET address_text = NULL, lat = NULL, lng = NULL, address_cleared_at = now()
      WHERE address_text IS NOT NULL AND state IN ${FINAL}
        AND updated_at < now() - make_interval(days => $1::int)`,
    [ADDRESS_RETENTION_DAYS],
  );
  return rowCount ?? 0;
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
export interface MoveDetails {
  cancelledBy?: 'customer' | 'shop';
  reason?: ShopCancelReason | null;
  text?: string | null;
}

export async function moveOrder(
  db: Queryable,
  id: string,
  event: OrderEvent,
  details: MoveDetails = {},
): Promise<MoveResult> {
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
  // What each move records, in the same guarded UPDATE: when the shop set out and the customer's
  // three hours; who cancelled and why.
  const { rowCount } = await db.query(
    `UPDATE delivery_orders
        SET state = $3, updated_at = now(),
            out_for_delivery_at = CASE WHEN $4::text = 'DISPATCH' THEN now() ELSE out_for_delivery_at END,
            receive_by = CASE WHEN $4::text = 'DISPATCH'
                              THEN now() + make_interval(hours => $5::int) ELSE receive_by END,
            cancelled_by = COALESCE($6::text, cancelled_by),
            cancel_reason = COALESCE($7::text, cancel_reason),
            cancel_text = COALESCE($8::text, cancel_text)
      WHERE id = $1 AND state = $2`,
    [
      id,
      current.state,
      next.to,
      event,
      RECEIVE_WINDOW_HOURS,
      details.cancelledBy ?? null,
      details.reason ?? null,
      details.text ?? null,
    ],
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

/** Ids of orders out for delivery whose customer did not tap Received in time. */
export async function findUnconfirmedOrderIds(db: Queryable, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM delivery_orders WHERE state = 'OUT_FOR_DELIVERY' AND receive_by <= now()
      ORDER BY receive_by LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}
