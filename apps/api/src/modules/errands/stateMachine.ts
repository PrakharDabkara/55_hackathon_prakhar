export const ERRAND_STATES = [
  'PLANNING',
  'WAITING_FOR_SHOPS',
  'NEEDS_INPUT',
  'PLAN_READY',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export const ERRAND_EVENTS = [
  'PLAN_SUBMITTED',
  'RUN_FAILED',
  'ASKED_SHOPS',
  'ASKED_USER',
  'SHOPS_REPLIED',
  'USER_ANSWERED',
  'EXPIRE',
  'CANCEL',
] as const;

export type ErrandState = (typeof ERRAND_STATES)[number];
export type ErrandEvent = (typeof ERRAND_EVENTS)[number];

export type ErrandTransition = { ok: true; to: ErrandState } | { ok: false };

/** PLAN_READY, FAILED, EXPIRED and CANCELLED never move again. */
export const FINAL_STATES: readonly ErrandState[] = [
  'PLAN_READY',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];
export const isFinal = (state: ErrandState) => FINAL_STATES.includes(state);

/**
 * Every allowed move (ADR-0024). `SHOPS_REPLIED` is any reason to wake a waiting errand (replies
 * came in, or the timer ran out); `USER_ANSWERED` includes an answer that timed out. Pure logic:
 * the guarded UPDATE in persistence.ts enforces it under concurrency.
 */
const MOVES: { [S in ErrandState]?: { [E in ErrandEvent]?: ErrandState } } = {
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

export function errandTransition(state: ErrandState, event: ErrandEvent): ErrandTransition {
  const to = MOVES[state]?.[event];
  return to ? { ok: true, to } : { ok: false };
}
