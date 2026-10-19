import type { Queryable } from '../../db/queryable.js';
import { stockExpiry, type QuantityHint } from './stock.js';

/** Does this shop have a learned-stock record for the item, fresh or not? */
export async function hasStockRecord(
  db: Queryable,
  shopId: string,
  itemId: string,
): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM shop_stock WHERE shop_id = $1 AND item_id = $2`, [
    shopId,
    itemId,
  ]);
  return rows.length > 0;
}

/**
 * A customer went there and found the item ("Mil gaya", ADR-0035): the answer is as fresh as if
 * the shop had given it now, is marked as confirmed by a customer, and one earlier wrong report is
 * forgiven. The shop's price and quantity are kept as they were.
 */
export async function confirmStockByCustomer(
  db: Queryable,
  shopId: string,
  itemId: string,
  now: Date,
): Promise<void> {
  const { rows } = await db.query<{ quantity_hint: QuantityHint | null; exact: boolean }>(
    `SELECT quantity_hint, qty_amount IS NOT NULL AS exact
       FROM shop_stock WHERE shop_id = $1 AND item_id = $2 FOR UPDATE`,
    [shopId, itemId],
  );
  const row = rows[0];
  if (!row) return;
  await db.query(
    `UPDATE shop_stock
        SET last_confirmed_at = $3, expires_at = $4, customer_verified_at = $3,
            wrong_reports = GREATEST(wrong_reports - 1, 0)
      WHERE shop_id = $1 AND item_id = $2`,
    [shopId, itemId, now, stockExpiry(now, row.quantity_hint, row.exact)],
  );
}

/**
 * Shops whose answer for this item a customer called wrong and that have not been asked since
 * (no ping sent after the report) and have not answered since. They are asked on the next search
 * even inside the ping dedupe window (ADR-0036); once asked, the ordinary window applies again.
 */
export async function shopsToAskAgain(db: Queryable, itemId: string): Promise<string[]> {
  const { rows } = await db.query<{ shop_id: string }>(
    `SELECT st.shop_id FROM shop_stock st
      WHERE st.item_id = $1 AND st.invalidated_at IS NOT NULL
        AND st.last_confirmed_at < st.invalidated_at
        AND NOT EXISTS (
          SELECT 1 FROM pings p
           WHERE p.shop_id = st.shop_id AND p.item_id = st.item_id AND p.sent_at > st.invalidated_at)`,
    [itemId],
  );
  return rows.map((r) => r.shop_id);
}

/**
 * A customer went there and it was not there ("Wahan nahi tha", ADR-0035): the learned answer
 * stops counting at once (it no longer shows as Likely anywhere) and is counted against the shop
 * for this item. The row keeps no trace of who said so.
 */
export async function invalidateStockByCustomer(
  db: Queryable,
  shopId: string,
  itemId: string,
  now: Date,
): Promise<void> {
  await db.query(
    `UPDATE shop_stock
        SET expires_at = LEAST(expires_at, $3), customer_verified_at = NULL,
            wrong_reports = wrong_reports + 1, invalidated_at = $3
      WHERE shop_id = $1 AND item_id = $2`,
    [shopId, itemId, now],
  );
}
