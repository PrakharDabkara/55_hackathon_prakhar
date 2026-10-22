import { Router } from 'express';
import type { Queryable } from '../../db/queryable.js';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { createRequireAdmin } from '../identity/index.js';
import { normaliseQuery } from './normalise.js';

/** `DELETE /admin/ai/cache?q=…`: forget one cached answer, for example a wrong one. Admin only; 404 for everyone else. */
export function cacheAdminRouter({
  db,
  adminToken,
}: {
  db: Queryable;
  adminToken: string;
}): Router {
  const router = Router();
  router.delete('/admin/ai/cache', createRequireAdmin(adminToken), async (req, res) => {
    const { q: asked } = parse(z.strictObject({ q: z.string().max(200).optional() }), req.query);
    const q = asked ? normaliseQuery(asked).text : '';
    if (!q) throw new ApiError(400, 'invalid_query', 'Give the query to forget as ?q=');
    const result = await db.query(`DELETE FROM query_cache WHERE normalised = $1`, [q]);
    res.json({ deleted: result.rowCount ?? 0 });
  });
  return router;
}
