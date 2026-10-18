/** One thing to bring: what the shop said yes to, and its price (null: the shop did not say). */
export interface OrderLine {
  name: string;
  count: number;
  pricePaise: number | null;
}

export type OrderState =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

/** A delivery order as its customer sees it (ADR-0031). Cash on delivery: no money moves in the app. */
export interface SeekerOrder {
  id: string;
  state: OrderState;
  shopId: string;
  shopName: string;
  requestId: string | null;
  errandId: string | null;
  lines: OrderLine[];
  itemsTotalPaise: number | null;
  unknownPriceCount: number;
  feePaise: number | null;
  feeMinutes: number | null;
  /** The customer's own words; kept on the order only. */
  addressText: string;
  customerName: string | null;
  payment: 'cash_on_delivery';
  /** The shop said no or did not answer: the customer picks it up instead. */
  pickupFallback: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A delivery order as its shop sees it. The address and the map link come only after the shop
 * has accepted; the contact line is a first name or "Grahak", never a phone.
 */
export interface ShopOrder {
  id: string;
  state: OrderState;
  lines: OrderLine[];
  itemsTotalPaise: number | null;
  unknownPriceCount: number;
  feePaise: number | null;
  contactName: string;
  final: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  addressText?: string;
  mapUrl?: string;
}

export interface NewOrder {
  shopId: string;
  requestId?: string;
  errandId?: string;
  addressText: string;
  customerName?: string;
}

export type OrderSource = { requestId: string } | { errandId: string };

export type ShopOrderVerb = 'accept' | 'decline' | 'out' | 'delivered';

/** The order for a shop on this screen: the newest one is the one that counts. */
export function orderForShop(
  orders: readonly SeekerOrder[],
  shopId: string,
): SeekerOrder | undefined {
  return orders.find((o) => o.shopId === shopId);
}
