import { describe, expect, it } from 'vitest';
import {
  ORDER_EVENTS,
  ORDER_EXPIRY_MINUTES,
  OFFER_FRESH_MINUTES,
  RECEIVE_WINDOW_HOURS,
  ORDER_STATES,
  isFinalOrderState,
  orderTransition,
  type OrderEvent,
  type OrderState,
} from './stateMachine.js';

/** Every allowed move of a delivery order (ADR-0031), written out once; everything else is refused. */
const ALLOWED: Partial<Record<OrderState, Partial<Record<OrderEvent, OrderState>>>> = {
  REQUESTED: {
    ACCEPT: 'ACCEPTED',
    DECLINE: 'DECLINED',
    EXPIRE: 'EXPIRED',
    CANCEL: 'CANCELLED',
  },
  ACCEPTED: { DISPATCH: 'OUT_FOR_DELIVERY', CANCEL: 'CANCELLED', SHOP_CANCEL: 'CANCELLED' },
  OUT_FOR_DELIVERY: { RECEIVE: 'DELIVERED', NOT_CONFIRM: 'NOT_CONFIRMED' },
};

describe('delivery order state machine', () => {
  it('knows the eight states and the eight events', () => {
    expect([...ORDER_STATES]).toEqual([
      'REQUESTED',
      'ACCEPTED',
      'DECLINED',
      'EXPIRED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'NOT_CONFIRMED',
    ]);
    expect([...ORDER_EVENTS]).toEqual([
      'ACCEPT',
      'DECLINE',
      'EXPIRE',
      'DISPATCH',
      'RECEIVE',
      'NOT_CONFIRM',
      'CANCEL',
      'SHOP_CANCEL',
    ]);
  });

  it('a shop has ten minutes to answer; an offer binds for 30; the customer has 3 hours to confirm', () => {
    expect(ORDER_EXPIRY_MINUTES).toBe(10);
    expect(OFFER_FRESH_MINUTES).toBe(30);
    expect(RECEIVE_WINDOW_HOURS).toBe(3);
  });

  for (const state of ORDER_STATES) {
    for (const event of ORDER_EVENTS) {
      const to = ALLOWED[state]?.[event];
      it(to ? `${state} + ${event} → ${to}` : `${state} + ${event} is refused`, () => {
        expect(orderTransition(state, event)).toEqual(to ? { ok: true, to } : { ok: false });
      });
    }
  }

  it('DECLINED, EXPIRED, DELIVERED, CANCELLED and NOT_CONFIRMED never move again', () => {
    for (const state of [
      'DECLINED',
      'EXPIRED',
      'DELIVERED',
      'CANCELLED',
      'NOT_CONFIRMED',
    ] as const) {
      expect(isFinalOrderState(state)).toBe(true);
      for (const event of ORDER_EVENTS) expect(orderTransition(state, event).ok).toBe(false);
    }
    for (const state of ['REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY'] as const)
      expect(isFinalOrderState(state)).toBe(false);
  });

  it('once the shop has set out, the customer can no longer cancel', () => {
    expect(orderTransition('OUT_FOR_DELIVERY', 'CANCEL').ok).toBe(false);
    expect(orderTransition('OUT_FOR_DELIVERY', 'SHOP_CANCEL').ok).toBe(false);
  });

  it('a shop can cancel only an ACCEPTED order', () => {
    expect(orderTransition('REQUESTED', 'SHOP_CANCEL').ok).toBe(false);
  });
});
