import type { OrderState } from './stateMachine.js';

export const SHOP_CANCEL_REASONS = ['out_of_stock', 'cannot_deliver_now', 'other'] as const;
export type ShopCancelReason = (typeof SHOP_CANCEL_REASONS)[number];

/** One thing to bring: what the shop said yes to, and its price (null: the shop did not say). */
export interface OrderLine {
  name: string;
  /** The Hindi catalog name, when there is one: the customer's screen can show it. */
  nameHi?: string;
  /** The customer's own word for it. Only the customer's views carry it; a shop sees `name`. */
  text?: string;
  /** The everyday catalog word the customer's text matched ("Maida"): a catalog word, so a shop may see it (ADR-0047). */
  displayName?: string;
  count: number;
  pricePaise: number | null;
  /** The shop has packed this line (ADR-0055). Absent means not packed. */
  packed?: boolean;
}

/** An order as stored. Only `view.ts` decides who sees which part. */
export interface OrderRecord {
  id: string;
  userId: string;
  shopId: string;
  shopName: string;
  logoUrl?: string | null | undefined;
  shopOwnerUserId: string | null;
  requestId: string | null;
  errandId: string | null;
  /** The shopping list this order came from, if any (ADR-0055). */
  listId: string | null;
  state: OrderState;
  /** A pickup holds no address, pin or name (ADR-0055). */
  fulfilment: 'delivery' | 'pickup';
  /** Where the shop is: a pickup customer walks there. */
  shopLat: number;
  shopLng: number;
  lines: OrderLine[];
  /** Left out when no line has a price. Lines without a price are not in it, never ₹0. */
  itemsTotalPaise: number | null;
  unknownPriceCount: number;
  feePaise: number | null;
  feeMinutes: number | null;
  /** Empty 30 days after the order ended (ADR-0033). */
  addressText: string | null;
  customerFirstName: string | null;
  lat: number | null;
  lng: number | null;
  /** The customer's note to the shop (≤140, phone numbers removed). */
  note: string | null;
  /** Set when the order becomes ACCEPTED (by the shop, or at once for a binding offer). */
  acceptedAt: Date | null;
  outForDeliveryAt: Date | null;
  /** The customer has until then to tap Received; after it the order is NOT_CONFIRMED. */
  receiveBy: Date | null;
  cancelledBy: 'customer' | 'shop' | null;
  cancelReason: ShopCancelReason | null;
  cancelText: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
