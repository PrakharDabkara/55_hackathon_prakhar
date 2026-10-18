export const ORDER_STATES = [
  'REQUESTED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;
export const ORDER_EVENTS = [
  'ACCEPT',
  'DECLINE',
  'EXPIRE',
  'DISPATCH',
  'DELIVER',
  'CANCEL',
] as const;

export type OrderState = (typeof ORDER_STATES)[number];
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export type OrderTransition = { ok: true; to: OrderState } | { ok: false };

/** A shop has this long to answer a new order (ADR-0031). */
export const ORDER_EXPIRY_MINUTES = 10;

/** These never move again. */
export const FINAL_ORDER_STATES: readonly OrderState[] = [
  'DECLINED',
  'EXPIRED',
  'DELIVERED',
  'CANCELLED',
];
export const isFinalOrderState = (state: OrderState) => FINAL_ORDER_STATES.includes(state);

/**
 * Every allowed move (ADR-0031). The customer may cancel while the order is REQUESTED or ACCEPTED,
 * not once the shop has set out. Pure logic: the guarded UPDATE in persistence.ts enforces it
 * under concurrency.
 */
const MOVES: { [S in OrderState]?: { [E in OrderEvent]?: OrderState } } = {
  REQUESTED: { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', EXPIRE: 'EXPIRED', CANCEL: 'CANCELLED' },
  ACCEPTED: { DISPATCH: 'OUT_FOR_DELIVERY', CANCEL: 'CANCELLED' },
  OUT_FOR_DELIVERY: { DELIVER: 'DELIVERED' },
};

export function orderTransition(state: OrderState, event: OrderEvent): OrderTransition {
  const to = MOVES[state]?.[event];
  return to ? { ok: true, to } : { ok: false };
}
