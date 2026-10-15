import type { RequestRecord } from './persistence.js';
import type { RequestsContext } from './service.js';

/**
 * Called once, after the commit, when a new request lands in PINGING (learned stock was too thin).
 * Queues the fan-out job; a failure here must not fail the request, which simply expires on time.
 */
export function onRequestPinging(
  ctx: Pick<RequestsContext, 'hooks' | 'logger'>,
  request: RequestRecord,
): void {
  void ctx.hooks?.enqueueFanout?.(request.id).catch((err: Error) => {
    ctx.logger.warn({ requestId: request.id, reason: err.message }, 'could not queue ping fan-out');
  });
}
