import type { OrderState } from './stateMachine.js';

/** One thing to bring: what the shop said yes to, and its price (null: the shop did not say). */
export interface OrderLine {
  name: string;
  /** The Hindi catalog name, when there is one: the customer's screen can show it. */
  nameHi?: string;
  /** The customer's own word for it. Only the customer's views carry it; a shop sees `name`. */
  text?: string;
  count: number;
  pricePaise: number | null;
}

/** An order as stored. Only `view.ts` decides who sees which part. */
export interface OrderRecord {
  id: string;
  userId: string;
  shopId: string;
  shopName: string;
  shopOwnerUserId: string | null;
  requestId: string | null;
  errandId: string | null;
  state: OrderState;
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
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
