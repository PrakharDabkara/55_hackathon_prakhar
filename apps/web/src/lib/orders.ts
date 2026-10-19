/** One thing to bring: what the shop said yes to, and its price (null: the shop did not say). */
export interface OrderLine {
  name: string;
  /** The Hindi catalog name, when the item has one. */
  nameHi?: string;
  /** The customer's own word for it (never sent to the shop). */
  text?: string;
  count: number;
  pricePaise: number | null;
}

/**
 * What to call the line on the customer's screen: their own word, or the Hindi name, on a Hindi
 * screen; the English name on an English one. Lines saved before these fields exist show `name`.
 */
export function lineName(line: OrderLine, lang: 'hi' | 'en'): string {
  return lang === 'hi' ? (line.text ?? line.nameHi ?? line.name) : line.name;
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
  /** The customer's own words; kept on the order only, and gone 30 days after it ended. */
  addressText: string | null;
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
  /** The customer ticked "Is pate ko yaad rakhein". */
  saveAddress?: boolean;
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

const ACTIVE_STATES: readonly OrderState[] = ['REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY'];

/** Still moving: the shop has not answered, or it is not delivered yet. */
export const isActiveOrder = (order: Pick<SeekerOrder, 'state'>): boolean =>
  ACTIVE_STATES.includes(order.state);

/** Open orders first, each group newest first, whatever order the server sent them in. */
export function activeFirst(orders: readonly SeekerOrder[]): SeekerOrder[] {
  const newest = (a: SeekerOrder, b: SeekerOrder) => b.createdAt.localeCompare(a.createdAt);
  return [
    ...orders.filter(isActiveOrder).sort(newest),
    ...orders.filter((o) => !isActiveOrder(o)).sort(newest),
  ];
}

/** Goods plus delivery fee; null when no line has a price (an unknown price is never ₹0). */
export function orderTotalPaise(order: SeekerOrder): number | null {
  return order.itemsTotalPaise === null ? null : order.itemsTotalPaise + (order.feePaise ?? 0);
}

/** The page the order came from, if it still exists. */
export function orderSourcePath(order: SeekerOrder): string | null {
  if (order.requestId) return `/app/request/${order.requestId}`;
  if (order.errandId) return `/app/errand/${order.errandId}`;
  return null;
}
