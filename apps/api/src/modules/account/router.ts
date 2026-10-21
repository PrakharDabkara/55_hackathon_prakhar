import { Router } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { hasLiveErrand } from '../errands/index.js';
import {
  anonymiseUser,
  authOf,
  createRequireAuth,
  displayPhone,
  lockLiveUser,
  phoneOf,
  requireRole,
  revokeSession,
} from '../identity/index.js';
import { eraseCustomerAddresses, hasOpenOrder } from '../orders/index.js';
import { removeAllSubscriptionsOf, removeSubscriptionOf } from '../push/index.js';
import { hasLiveRequest } from '../requests/index.js';
import { createAttemptLimiter, type AttemptLimiter } from './attemptLimit.js';

const logoutBody = z.object({ pushEndpoint: z.string().min(1).max(2048).optional() });

/** The customer's account (ADR-0054): who they are, log out, and delete. Every route is the caller's own. */
export function accountRouter({
  db,
  logger,
  deleteLimiter = createAttemptLimiter({ max: 5, windowMs: 60 * 60 * 1000 }),
}: {
  db: Database;
  logger: Logger;
  deleteLimiter?: AttemptLimiter;
}): Router {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.get('/account', requireAuth, async (req, res) => {
    const phone = await phoneOf(db, authOf(req).user.id);
    res.json({ phoneMasked: phone ? displayPhone(phone) : null });
  });

  // Ends this login for good and forgets this one browser's alerts, in one call: the token dies
  // here, so the client could not unsubscribe afterwards.
  router.post('/account/logout', requireAuth, async (req, res) => {
    const { pushEndpoint } = parse(logoutBody, req.body ?? {});
    const { sessionId, user } = authOf(req);
    await withTransaction(db, async (tx) => {
      if (pushEndpoint) await removeSubscriptionOf(tx, user.id, pushEndpoint);
      await revokeSession(tx, sessionId);
    });
    (req.log ?? logger).info({ userId: user.id }, 'logout');
    res.status(204).end();
  });

  router.delete('/account', requireAuth, requireRole('seeker'), async (req, res) => {
    const { user } = authOf(req);
    if (!deleteLimiter.allow(user.id)) {
      throw new ApiError(429, 'rate_limited', 'Too many tries. Try again in an hour.');
    }
    await withTransaction(db, async (tx) => {
      // Lock the row first, so nothing can slip in between the checks and the erase.
      if (!(await lockLiveUser(tx, user.id))) {
        throw new ApiError(404, 'not_found', 'No such account');
      }
      if (
        (await hasOpenOrder(tx, user.id)) ||
        (await hasLiveRequest(tx, user.id)) ||
        (await hasLiveErrand(tx, user.id))
      ) {
        throw new ApiError(409, 'open_order', 'Finish or cancel your open order first.');
      }
      await removeAllSubscriptionsOf(tx, user.id);
      await eraseCustomerAddresses(tx, user.id);
      await anonymiseUser(tx, user.id);
    });
    (req.log ?? logger).info({ userId: user.id }, 'account deleted');
    res.status(204).end();
  });

  return router;
}
