import { Router } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAdmin, isAdminUser } from '../identity/index.js';
import type { Realtime } from '../realtime/index.js';
import { createSimulatedShops, removeSimulatedShops } from './service.js';

const createBody = z.object({
  count: z.number().int().min(1).max(500),
  centre: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  radiusM: z.number().int().min(100).max(20_000),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31),
});

interface Deps {
  db: Database;
  logger: Logger;
  realtime: Realtime;
  adminPhones: readonly string[];
}

const hidden = () => new ApiError(404, 'not_found', 'No such route');

/**
 * Admin-only simulator endpoints. Every refusal is the same 404 as an unknown route, so nobody
 * can tell they exist; with no ADMIN_PHONES nobody can use them at all.
 */
export function simulationRouter({ db, logger, realtime, adminPhones }: Deps): Router {
  const router = Router();
  const requireAdmin = createRequireAdmin(db, adminPhones);

  router.post('/admin/sim/shops', requireAdmin, async (req, res) => {
    const input = parse(createBody, req.body);
    const shops = await createSimulatedShops(db, input);
    (req.log ?? logger).info(
      { adminId: authOf(req).user.id, count: shops.length, seed: input.seed },
      'simulated shops created',
    );
    res.status(201).json(shops);
  });

  router.delete('/admin/sim/shops', requireAdmin, async (req, res) => {
    const removed = await removeSimulatedShops(db);
    (req.log ?? logger).info(
      { adminId: authOf(req).user.id, ...removed },
      'simulated shops removed',
    );
    res.json(removed);
  });

  // One stream with ping.created for every simulated shop, so the simulator needs one connection,
  // not hundreds. It authenticates with a one-time ticket, like every stream.
  router.get('/admin/sim/events', async (req, res) => {
    const raw = req.query['ticket'];
    const holder =
      typeof raw === 'string' && raw.length > 0 && raw.length <= 200
        ? await realtime.consumeTicket(raw).catch(() => null)
        : null;
    if (!holder || !(await isAdminUser(db, holder.userId, adminPhones))) throw hidden();
    realtime.openStream(req, res, { admin: true });
  });

  return router;
}
