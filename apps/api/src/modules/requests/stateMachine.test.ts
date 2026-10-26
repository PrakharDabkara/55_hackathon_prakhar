import { describe, expect, it } from 'vitest';
import {
  EVENTS,
  STATES,
  transition,
  type RequestEvent,
  type RequestState,
} from './stateMachine.js';

type Expected = RequestState | 'NOOP' | 'INVALID';

/** The whole table: every state × event pair, written out. */
const TABLE: Record<RequestState, Record<RequestEvent, Expected>> = {
  OPEN: {
    STOCK_SUFFICIENT: 'ANSWERED',
    STOCK_INSUFFICIENT: 'PINGING',
    SHOP_SAID_YES: 'INVALID',
    TIMEOUT: 'INVALID',
    USER_CLOSED: 'CLOSED',
    ASK_SHOPS: 'INVALID',
    NOBODY_LEFT: 'INVALID',
  },
  PINGING: {
    STOCK_SUFFICIENT: 'INVALID',
    STOCK_INSUFFICIENT: 'INVALID',
    SHOP_SAID_YES: 'ANSWERED',
    TIMEOUT: 'EXPIRED',
    USER_CLOSED: 'CLOSED',
    ASK_SHOPS: 'INVALID',
    // Every asked shop said no, or nobody could be asked (round 3 C-17).
    NOBODY_LEFT: 'EXPIRED',
  },
  ANSWERED: {
    STOCK_SUFFICIENT: 'INVALID',
    STOCK_INSUFFICIENT: 'INVALID',
    SHOP_SAID_YES: 'NOOP',
    TIMEOUT: 'CLOSED',
    USER_CLOSED: 'CLOSED',
    ASK_SHOPS: 'PINGING',
    NOBODY_LEFT: 'INVALID',
  },
  EXPIRED: {
    STOCK_SUFFICIENT: 'INVALID',
    STOCK_INSUFFICIENT: 'INVALID',
    SHOP_SAID_YES: 'INVALID',
    TIMEOUT: 'INVALID',
    USER_CLOSED: 'INVALID',
    ASK_SHOPS: 'INVALID',
    NOBODY_LEFT: 'INVALID',
  },
  CLOSED: {
    STOCK_SUFFICIENT: 'INVALID',
    STOCK_INSUFFICIENT: 'INVALID',
    SHOP_SAID_YES: 'INVALID',
    TIMEOUT: 'INVALID',
    USER_CLOSED: 'INVALID',
    ASK_SHOPS: 'INVALID',
    NOBODY_LEFT: 'INVALID',
  },
};

describe('request state machine', () => {
  it('knows five states and seven events', () => {
    expect([...STATES]).toEqual(['OPEN', 'PINGING', 'ANSWERED', 'EXPIRED', 'CLOSED']);
    expect([...EVENTS]).toEqual([
      'STOCK_SUFFICIENT',
      'STOCK_INSUFFICIENT',
      'SHOP_SAID_YES',
      'TIMEOUT',
      'USER_CLOSED',
      'ASK_SHOPS',
      'NOBODY_LEFT',
    ]);
  });

  it('the table above covers every state × event pair', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...STATES].sort());
    for (const state of STATES) {
      expect(Object.keys(TABLE[state]).sort(), state).toEqual([...EVENTS].sort());
    }
  });

  const pairs = STATES.flatMap((state) => EVENTS.map((event) => [state, event] as const));

  it.each(pairs)('%s + %s', (state, event) => {
    const expected = TABLE[state][event];
    const result = transition(state, event);

    if (expected === 'INVALID') {
      expect(result).toEqual({ ok: false, error: { code: 'INVALID_TRANSITION', state, event } });
    } else if (expected === 'NOOP') {
      expect(result).toEqual({ ok: true, to: state, changed: false });
    } else {
      expect(result).toEqual({ ok: true, to: expected, changed: true });
    }
  });
});
