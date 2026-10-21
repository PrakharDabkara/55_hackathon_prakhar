import type { Queryable } from '../../db/queryable.js';

/** An order the shop has not finished: waiting, accepted or on its way. */
export async function hasOpenOrder(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM delivery_orders
      WHERE user_id = $1 AND state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'READY') LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Account deletion (ADR-0054): the saved address goes, and so do the address, pin and first name
 * on the customer's past orders. The orders themselves stay, pointing at the anonymised user.
 */
export async function eraseCustomerAddresses(db: Queryable, userId: string): Promise<void> {
  await db.query(`DELETE FROM saved_addresses WHERE user_id = $1`, [userId]);
  await db.query(
    `UPDATE delivery_orders
        SET address_text = NULL, lat = NULL, lng = NULL, customer_first_name = NULL,
            address_cleared_at = COALESCE(address_cleared_at, now())
      WHERE user_id = $1`,
    [userId],
  );
}
