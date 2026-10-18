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
            wrong_reports = wrong_reports + 1
      WHERE shop_id = $1 AND item_id = $2`,
    [shopId, itemId, now],
  );
}
