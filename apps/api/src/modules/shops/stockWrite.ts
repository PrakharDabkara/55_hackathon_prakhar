import type { Queryable } from '../../db/queryable.js';
import type { ExactQuantity } from '@kahanmilega/shared';
import { stockExpiry, type DeliveryOffer, type QuantityHint } from './stock.js';

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
    quantity?: ExactQuantity | null;
    delivery?: DeliveryOffer | null;
    confirmedAt: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO shop_stock (shop_id, item_id, source, quantity_hint, price_paise,
                             last_confirmed_at, expires_at, qty_amount, qty_unit,
                             delivers, delivery_fee_paise, delivery_minutes)
     VALUES ($1, $2, 'ping_yes', $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (shop_id, item_id) DO UPDATE
       SET source = 'ping_yes', quantity_hint = EXCLUDED.quantity_hint,
           price_paise = EXCLUDED.price_paise, last_confirmed_at = EXCLUDED.last_confirmed_at,
           expires_at = EXCLUDED.expires_at, qty_amount = EXCLUDED.qty_amount,
           qty_unit = EXCLUDED.qty_unit, delivers = EXCLUDED.delivers,
           delivery_fee_paise = EXCLUDED.delivery_fee_paise,
           delivery_minutes = EXCLUDED.delivery_minutes`,
    [
      stock.shopId,
      stock.itemId,
      stock.quantityHint,
      stock.pricePaise,
      stock.confirmedAt,
      stockExpiry(stock.confirmedAt, stock.quantityHint, Boolean(stock.quantity)),
      stock.quantity?.amount ?? null,
      stock.quantity?.unit ?? null,
      Boolean(stock.delivery),
      stock.delivery?.feePaise ?? null,
      stock.delivery?.minutes ?? null,
    ],
  );
  // A customer-made item (ADR-0028) is verified by the first shop that says yes.
  await db.query(`UPDATE items SET unverified = false WHERE id = $1 AND unverified`, [
    stock.itemId,
  ]);
}
