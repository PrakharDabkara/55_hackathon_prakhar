import { isFinalOrderState, type OrderState } from './stateMachine.js';
import type { OrderLine, OrderRecord, ShopCancelReason } from './types.js';

/** The shop learns the address only from these states on: after it said yes (ADR-0031). */
const ADDRESS_SHOWN_TO_SHOP: readonly OrderState[] = [
  'ACCEPTED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'NOT_CONFIRMED',
];

export interface SeekerOrderView {
  id: string;
  state: OrderState;
  shopId: string;
  shopName: string;
  /** The shop's published logo, or null (ADR-0040). */
  logoUrl: string | null;
  requestId: string | null;
  errandId: string | null;
  lines: OrderLine[];
  itemsTotalPaise: number | null;
  unknownPriceCount: number;
  feePaise: number | null;
  feeMinutes: number | null;
  /** The customer's own words. Cash on delivery: no money moves in the app. */
  /** Empty once the order ended 30 days ago (ADR-0033). */
  addressText: string | null;
  customerName: string | null;
  payment: 'cash_on_delivery';
  /** The shop did not take it (declined or no answer in time): the customer picks it up instead. */
  pickupFallback: boolean;
  note: string | null;
  /** Only while OUT_FOR_DELIVERY: the customer should tap Received before this. */
  receiveBy: string | null;
  cancelledBy: 'customer' | 'shop' | null;
  cancelReason: ShopCancelReason | null;
  cancelText: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShopOrderView {
  id: string;
  state: OrderState;
  lines: OrderLine[];
  itemsTotalPaise: number | null;
  unknownPriceCount: number;
  feePaise: number | null;
  /** The customer's first name if they gave one, else "Grahak". Never a phone. */
  contactName: string;
  final: boolean;
  /** What the customer wrote for the shop (≤140, phone numbers removed). */
  note: string | null;
  /** Only on an order the shop cancelled, for its own record. */
  cancelReason: ShopCancelReason | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  /** Only after ACCEPTED: the typed address and a map link to the pin. */
  addressText?: string;
  mapUrl?: string;
}

export function seekerOrderView(o: OrderRecord): SeekerOrderView {
  return {
    id: o.id,
    state: o.state,
    shopId: o.shopId,
    shopName: o.shopName,
    logoUrl: o.logoUrl ?? null,
    requestId: o.requestId,
    errandId: o.errandId,
    lines: o.lines,
    itemsTotalPaise: o.itemsTotalPaise,
    unknownPriceCount: o.unknownPriceCount,
    feePaise: o.feePaise,
    feeMinutes: o.feeMinutes,
    addressText: o.addressText,
    customerName: o.customerFirstName,
    payment: 'cash_on_delivery',
    pickupFallback: o.state === 'DECLINED' || o.state === 'EXPIRED',
    note: o.note,
    receiveBy: o.state === 'OUT_FOR_DELIVERY' && o.receiveBy ? o.receiveBy.toISOString() : null,
    cancelledBy: o.cancelledBy,
    cancelReason: o.cancelReason,
    cancelText: o.cancelText,
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export const mapUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** Built field by field, so a new column on the order never reaches a shop by accident. */
export function shopOrderView(o: OrderRecord): ShopOrderView {
  return {
    id: o.id,
    state: o.state,
    // Field by field: the customer's own words stay with the customer.
    lines: o.lines.map(({ name, count, pricePaise }) => ({ name, count, pricePaise })),
    itemsTotalPaise: o.itemsTotalPaise,
    unknownPriceCount: o.unknownPriceCount,
    feePaise: o.feePaise,
    contactName: o.customerFirstName ?? 'Grahak',
    final: isFinalOrderState(o.state),
    note: o.note,
    cancelReason: o.cancelledBy === 'shop' ? o.cancelReason : null,
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    ...(ADDRESS_SHOWN_TO_SHOP.includes(o.state) &&
      o.addressText !== null &&
      o.lat !== null &&
      o.lng !== null && { addressText: o.addressText, mapUrl: mapUrl(o.lat, o.lng) }),
  };
}
