import { isFinalOrderState, type OrderState } from './stateMachine.js';
import type { OrderLine, OrderRecord } from './types.js';

/** The shop learns the address only from these states on: after it said yes (ADR-0031). */
const ADDRESS_SHOWN_TO_SHOP: readonly OrderState[] = ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export interface SeekerOrderView {
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
  /** The customer's own words. Cash on delivery: no money moves in the app. */
  addressText: string;
  customerName: string | null;
  payment: 'cash_on_delivery';
  /** The shop did not take it (declined or no answer in time): the customer picks it up instead. */
  pickupFallback: boolean;
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
    lines: o.lines,
    itemsTotalPaise: o.itemsTotalPaise,
    unknownPriceCount: o.unknownPriceCount,
    feePaise: o.feePaise,
    contactName: o.customerFirstName ?? 'Grahak',
    final: isFinalOrderState(o.state),
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    ...(ADDRESS_SHOWN_TO_SHOP.includes(o.state) && {
      addressText: o.addressText,
      mapUrl: mapUrl(o.lat, o.lng),
    }),
  };
}
