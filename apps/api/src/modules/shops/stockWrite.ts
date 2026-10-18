import type { Queryable } from '../../db/queryable.js';
import { stockExpiry, type QuantityHint } from './stock.js';

/**
 * A shop said yes: it now has this item. One row per shop and item, refreshed on every yes
 * (price, hint, confirmation time and expiry all replaced).
 */
export async function recordStockYes(
  db: Queryable,
  stock: {
    shopId: string;
    itemId: string;
    pricePaise: number | null;
    quantityHint: QuantityHint | null;
    confirmedAt: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO shop_stock (shop_id, item_id, source, quantity_hint, price_paise,
                             last_confirmed_at, expires_at)
     VALUES ($1, $2, 'ping_yes', $3, $4, $5, $6)
     ON CONFLICT (shop_id, item_id) DO UPDATE
       SET source = 'ping_yes', quantity_hint = EXCLUDED.quantity_hint,
           price_paise = EXCLUDED.price_paise, last_confirmed_at = EXCLUDED.last_confirmed_at,
           expires_at = EXCLUDED.expires_at`,
    [
      stock.shopId,
      stock.itemId,
      stock.quantityHint,
      stock.pricePaise,
      stock.confirmedAt,
      stockExpiry(stock.confirmedAt, stock.quantityHint),
    ],
  );
  // A customer-made item (ADR-0028) is verified by the first shop that says yes.
  await db.query(`UPDATE items SET unverified = false WHERE id = $1 AND unverified`, [
    stock.itemId,
  ]);
}
