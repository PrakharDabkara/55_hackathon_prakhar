import { Router } from 'express';
import { z } from 'zod';
import type { Queryable } from '../../db/queryable.js';
import { parse } from '../../http/errors.js';
import { resolveItem } from '../catalog/index.js';
import { authOf, createRequireAuth } from '../identity/index.js';
import { findLearnedStock } from '../shops/index.js';

const DEFAULT_RADIUS_M = 2000;
const MAX_RADIUS_M = 5000;

const query = z.object({
  q: z.string().trim().min(1).max(200),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(1).max(MAX_RADIUS_M).default(DEFAULT_RADIUS_M),
});

interface SearchDeps {
  db: Queryable;
  trigramThreshold: number;
}

export function searchRouter({ db, trigramThreshold }: SearchDeps): Router {
  const router = Router();

  router.get('/search', createRequireAuth(db), async (req, res) => {
    const { q, lat, lng, radius_m } = parse(query, req.query);
    const resolution = await resolveItem(db, q, {
      userId: authOf(req).user.id,
      threshold: trigramThreshold,
    });
    const results = resolution.item
      ? await findLearnedStock(db, resolution.item.id, lat, lng, radius_m)
      : [];

    res.json({
      query: {
        normalised: resolution.normalised,
        ...(resolution.quantity && { quantity: resolution.quantity }),
      },
      item: resolution.item,
      matchedBy: resolution.matchedBy,
      results,
    });
  });

  return router;
}
