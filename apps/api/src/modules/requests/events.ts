import type { Logger } from 'pino';
import type { EventPublisher } from '../realtime/index.js';
import type { ApplyResult, ClosedPing } from './persistence.js';

/**
 * Tells the seeker their request moved and the shops their open pings ended. Call it only after
 * the transaction that made the move has committed. Hints only: ids and a state, nothing else.
 */
export function announceTransition(
  events: EventPublisher | undefined,
  result: ApplyResult,
  log?: Logger,
): void {
  if (!events || result.kind !== 'applied') return;
  events.publish(
    {
      to: { userId: result.request.userId },
      type: 'request.updated',
      data: { requestId: result.request.id, state: result.request.state },
    },
    log,
  );
  announceClosedPings(events, result.closedPings, 'request_ended', log);
}

/** Why the ping went away, so the shop's screen can say "thanks" instead of just dropping it. */
export function announceClosedPings(
  events: EventPublisher | undefined,
  pings: ClosedPing[],
  reason: 'enough_answers' | 'request_ended' | 'customer_chose',
  log?: Logger,
): void {
  if (!events) return;
  for (const ping of pings) {
    if (!ping.ownerUserId) continue;
    events.publish(
      { to: { userId: ping.ownerUserId }, type: 'ping.closed', data: { pingId: ping.id, reason } },
      log,
    );
  }
}
