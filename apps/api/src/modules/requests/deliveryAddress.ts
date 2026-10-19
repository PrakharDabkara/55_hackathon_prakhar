import type { Queryable } from '../../db/queryable.js';

/**
 * Whether this saved address is the customer's own and still there (ADR-0039). A request only
 * points at it; the address itself stays with the customer until an order is ACCEPTED.
 */
export async function ownsSavedAddress(
  db: Queryable,
  userId: string,
  addressId: string | undefined | null,
): Promise<boolean> {
  if (!addressId) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM saved_addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId],
  );
  return (rowCount ?? 0) > 0;
}
