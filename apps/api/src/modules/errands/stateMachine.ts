export const ERRAND_STATES = ['PLANNING', 'PLAN_READY', 'FAILED'] as const;
export const ERRAND_EVENTS = ['PLAN_SUBMITTED', 'RUN_FAILED'] as const;

export type ErrandState = (typeof ERRAND_STATES)[number];
export type ErrandEvent = (typeof ERRAND_EVENTS)[number];

export type ErrandTransition = { ok: true; to: ErrandState } | { ok: false };

/**
 * Every allowed move. Day 13 adds NEEDS_INPUT and WAITING_FOR_SHOPS here and to the CHECK
 * constraint on errands.state (ADR-0024). Pure logic: the guarded UPDATE in persistence.ts enforces
 * it under concurrency.
 */
const MOVES: { [S in ErrandState]?: { [E in ErrandEvent]?: ErrandState } } = {
  PLANNING: { PLAN_SUBMITTED: 'PLAN_READY', RUN_FAILED: 'FAILED' },
};

export function errandTransition(state: ErrandState, event: ErrandEvent): ErrandTransition {
  const to = MOVES[state]?.[event];
  return to ? { ok: true, to } : { ok: false };
}
