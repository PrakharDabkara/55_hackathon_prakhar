import { Router } from 'express';
import type { Queryable } from '../../db/queryable.js';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import { findShopByOwner } from '../shops/index.js';
import { shopDemand } from './service.js';
import { parseDays } from './window.js';

/** "Aaj ki maang" for the signed-in shop's own screen (ADR-0035). */
export function demandRouter({ db }: { db: Queryable }): Router {
  const router = Router();

  router.get('/shops/me/demand', createRequireAuth(db), requireRole('shop'), async (req, res) => {
    const { days: asked } = parse(
      z.strictObject({ days: z.string().max(4).optional() }),
      req.query,
    );
    const days = parseDays(asked);
    const shop = await findShopByOwner(db, authOf(req).user.id);
    if (!shop) throw new ApiError(404, 'not_found', 'You have not created a shop yet');
    res.json(await shopDemand(db, shop.id, days));
  });

  return router;
}
