import { describe, expect, it } from 'vitest';
import {
  ORDER_EVENTS,
  ORDER_EXPIRY_MINUTES,
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
  ACCEPTED: { DISPATCH: 'OUT_FOR_DELIVERY', CANCEL: 'CANCELLED' },
  OUT_FOR_DELIVERY: { DELIVER: 'DELIVERED' },
};

describe('delivery order state machine', () => {
  it('knows the seven states and the six events', () => {
    expect([...ORDER_STATES]).toEqual([
      'REQUESTED',
      'ACCEPTED',
      'DECLINED',
      'EXPIRED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
    ]);
    expect([...ORDER_EVENTS]).toEqual([
      'ACCEPT',
      'DECLINE',
      'EXPIRE',
      'DISPATCH',
      'DELIVER',
      'CANCEL',
    ]);
  });

  it('a shop has ten minutes to answer', () => {
    expect(ORDER_EXPIRY_MINUTES).toBe(10);
  });

  for (const state of ORDER_STATES) {
    for (const event of ORDER_EVENTS) {
      const to = ALLOWED[state]?.[event];
      it(to ? `${state} + ${event} → ${to}` : `${state} + ${event} is refused`, () => {
        expect(orderTransition(state, event)).toEqual(to ? { ok: true, to } : { ok: false });
      });
    }
  }

  it('DECLINED, EXPIRED, DELIVERED and CANCELLED never move again', () => {
    for (const state of ['DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED'] as const) {
      expect(isFinalOrderState(state)).toBe(true);
      for (const event of ORDER_EVENTS) expect(orderTransition(state, event).ok).toBe(false);
    }
    for (const state of ['REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY'] as const)
      expect(isFinalOrderState(state)).toBe(false);
  });

  it('once the shop has set out, the customer can no longer cancel', () => {
    expect(orderTransition('OUT_FOR_DELIVERY', 'CANCEL').ok).toBe(false);
  });
});
