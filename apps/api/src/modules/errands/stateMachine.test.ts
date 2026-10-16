import { describe, expect, it } from 'vitest';
import { ERRAND_EVENTS, ERRAND_STATES, errandTransition } from './stateMachine.js';

type State = (typeof ERRAND_STATES)[number];
type Event = (typeof ERRAND_EVENTS)[number];

/** Every allowed move of the errand, written out once; everything else must be refused. */
const ALLOWED: Partial<Record<State, Partial<Record<Event, State>>>> = {
  PLANNING: {
    PLAN_SUBMITTED: 'PLAN_READY',
    RUN_FAILED: 'FAILED',
    ASKED_SHOPS: 'WAITING_FOR_SHOPS',
    ASKED_USER: 'NEEDS_INPUT',
    EXPIRE: 'EXPIRED',
    CANCEL: 'CANCELLED',
  },
  WAITING_FOR_SHOPS: { SHOPS_REPLIED: 'PLANNING', EXPIRE: 'EXPIRED', CANCEL: 'CANCELLED' },
  NEEDS_INPUT: { USER_ANSWERED: 'PLANNING', EXPIRE: 'EXPIRED', CANCEL: 'CANCELLED' },
};

describe('errand state machine', () => {
  it('knows the seven states and the eight events', () => {
    expect([...ERRAND_STATES]).toEqual([
      'PLANNING',
      'WAITING_FOR_SHOPS',
      'NEEDS_INPUT',
      'PLAN_READY',
      'FAILED',
      'EXPIRED',
      'CANCELLED',
    ]);
    expect([...ERRAND_EVENTS]).toEqual([
      'PLAN_SUBMITTED',
      'RUN_FAILED',
      'ASKED_SHOPS',
      'ASKED_USER',
      'SHOPS_REPLIED',
      'USER_ANSWERED',
      'EXPIRE',
      'CANCEL',
    ]);
  });

  describe('every state × event', () => {
    for (const state of ERRAND_STATES) {
      for (const event of ERRAND_EVENTS) {
        const to = ALLOWED[state]?.[event];
        it(`${state} + ${event} ${to ? `→ ${to}` : 'is refused'}`, () => {
          expect(errandTransition(state, event)).toEqual(to ? { ok: true, to } : { ok: false });
        });
      }
    }
  });

  it('PLAN_READY, FAILED, EXPIRED and CANCELLED are final', () => {
    for (const state of ['PLAN_READY', 'FAILED', 'EXPIRED', 'CANCELLED'] as const)
      for (const event of ERRAND_EVENTS)
        expect(errandTransition(state, event), `${state} ${event}`).toEqual({ ok: false });
  });
});
