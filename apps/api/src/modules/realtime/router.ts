import { Router } from 'express';
import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { authOf, createRequireAuth, hasLiveSession } from '../identity/index.js';
import type { Realtime } from './realtime.js';

const unavailable = () =>
  new ApiError(503, 'realtime_unavailable', 'Live updates are not available right now');

/** Stream routes only: `POST /events/ticket` and `GET /events?ticket=`. */
export function realtimeRouter({ db, realtime }: { db: Queryable; realtime: Realtime }): Router {
  const router = Router();

  router.post('/events/ticket', createRequireAuth(db), async (req, res) => {
    if (!realtime.enabled) throw unavailable();
    const ticket = await realtime.issueTicket(authOf(req).user).catch(() => {
      throw unavailable();
    });
    res.json({ ticket, expiresInSeconds: realtime.ticketTtlSeconds });
  });

  // The bearer token is never read here: a URL ends up in logs and history, a one-time ticket does not hurt.
  router.get('/events', async (req, res) => {
    const raw = req.query['ticket'];
    const holder =
      realtime.enabled && typeof raw === 'string' && raw.length > 0 && raw.length <= 200
        ? await realtime.consumeTicket(raw).catch(() => null)
        : null;
    // A ticket asked for just before "log out on all devices" must not open a stream after it.
    if (!holder || !(await hasLiveSession(db, holder.userId)))
      throw new ApiError(401, 'invalid_ticket', 'That ticket is missing, used or expired');
    realtime.openStream(req, res, { userId: holder.userId });
  });

  return router;
}
