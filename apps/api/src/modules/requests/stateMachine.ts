export const STATES = ['OPEN', 'PINGING', 'ANSWERED', 'EXPIRED', 'CLOSED'] as const;
export const EVENTS = [
  'STOCK_SUFFICIENT',
  'STOCK_INSUFFICIENT',
  'SHOP_SAID_YES',
  'TIMEOUT',
  'USER_CLOSED',
] as const;

export type RequestState = (typeof STATES)[number];
export type RequestEvent = (typeof EVENTS)[number];

export type TransitionResult =
  /** `changed: false` means the event is accepted but nothing moves (a late yes on an answered request). */
  | { ok: true; to: RequestState; changed: boolean }
  | { ok: false; error: { code: 'INVALID_TRANSITION'; state: RequestState; event: RequestEvent } };

/**
 * Every allowed move. A pair that is not here is invalid. Pure logic, no database:
 * the guarded UPDATE in the service enforces it under concurrency.
 */
const MOVES: { [S in RequestState]?: { [E in RequestEvent]?: RequestState } } = {
  OPEN: { STOCK_SUFFICIENT: 'ANSWERED', STOCK_INSUFFICIENT: 'PINGING', USER_CLOSED: 'CLOSED' },
  PINGING: { SHOP_SAID_YES: 'ANSWERED', TIMEOUT: 'EXPIRED', USER_CLOSED: 'CLOSED' },
  ANSWERED: { SHOP_SAID_YES: 'ANSWERED', TIMEOUT: 'CLOSED', USER_CLOSED: 'CLOSED' },
};

export function transition(state: RequestState, event: RequestEvent): TransitionResult {
  const to = MOVES[state]?.[event];
  if (!to) return { ok: false, error: { code: 'INVALID_TRANSITION', state, event } };
  return { ok: true, to, changed: to !== state };
}
