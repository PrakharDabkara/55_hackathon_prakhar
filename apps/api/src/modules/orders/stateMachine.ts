export const ORDER_STATES = [
  'REQUESTED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'NOT_CONFIRMED',
] as const;
export const ORDER_EVENTS = [
  'ACCEPT',
  'DECLINE',
  'EXPIRE',
  'DISPATCH',
  'RECEIVE',
  'NOT_CONFIRM',
  'CANCEL',
  'SHOP_CANCEL',
] as const;

export type OrderState = (typeof ORDER_STATES)[number];
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export type OrderTransition = { ok: true; to: OrderState } | { ok: false };

/** A shop has this long to answer a new order (ADR-0031). */
export const ORDER_EXPIRY_MINUTES = 10;

/** A shop's own yes, this fresh, is a binding offer: the customer's order starts ACCEPTED (ADR-0039). */
export const OFFER_FRESH_MINUTES = 30;

/** The customer has this long after the shop sets out to tap Received (ADR-0039). */
export const RECEIVE_WINDOW_HOURS = 3;

/** These never move again. */
export const FINAL_ORDER_STATES: readonly OrderState[] = [
  'DECLINED',
  'EXPIRED',
  'DELIVERED',
  'CANCELLED',
  'NOT_CONFIRMED',
];
export const isFinalOrderState = (state: OrderState) => FINAL_ORDER_STATES.includes(state);

/**
 * Every allowed move (ADR-0031, ADR-0039). The customer may cancel while the order is REQUESTED or
 * ACCEPTED, the shop only while it is ACCEPTED, neither once the shop has set out. Only the customer
 * ends a delivery (RECEIVE); with no Received in time it is NOT_CONFIRMED, never DELIVERED. Pure logic: the guarded UPDATE in persistence.ts enforces it
 * under concurrency.
 */
const MOVES: { [S in OrderState]?: { [E in OrderEvent]?: OrderState } } = {
  REQUESTED: { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', EXPIRE: 'EXPIRED', CANCEL: 'CANCELLED' },
  ACCEPTED: { DISPATCH: 'OUT_FOR_DELIVERY', CANCEL: 'CANCELLED', SHOP_CANCEL: 'CANCELLED' },
  OUT_FOR_DELIVERY: { RECEIVE: 'DELIVERED', NOT_CONFIRM: 'NOT_CONFIRMED' },
};

export function orderTransition(state: OrderState, event: OrderEvent): OrderTransition {
  const to = MOVES[state]?.[event];
  return to ? { ok: true, to } : { ok: false };
}
