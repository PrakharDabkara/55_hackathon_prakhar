import { Router } from 'express';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import {
  answerErrand,
  cancelErrand,
  createErrand,
  getErrand,
  type ErrandsContext,
} from './service.js';

export function errandsRouter(deps: ErrandsContext): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.db);
  const createBody = z.object({
    task: z.string().trim().min(1).max(deps.limits.taskMaxChars),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    budgetPaise: z.number().int().min(1).max(10_000_000).optional(),
  });

  router.post('/errands', requireAuth, requireRole('seeker'), async (req, res) => {
    const body = parse(createBody, req.body);
    // The HTTP logger carries the request id, so the agent's lines join the request that began it.
    const created = await createErrand(
      { ...deps, logger: req.log ?? deps.logger },
      authOf(req).user.id,
      { ...body, requestId: String(req.id) },
    );
    res.status(201).json(created);
  });

  router.get('/errands/:id', requireAuth, async (req, res) => {
    const view = await getErrand(
      { ...deps, logger: req.log ?? deps.logger },
      authOf(req).user.id,
      String(req.params['id']),
    );
    if (!view) throw new ApiError(404, 'not_found', 'No such errand');
    res.json(view);
  });

  // Owner only. Exactly one of text or optionIndex; checked in the service so every caller gets the same rules.
  const answerBody = z.object({
    text: z.string().optional(),
    optionIndex: z.number().int().min(0).max(10).optional(),
  });
  router.post('/errands/:id/answer', requireAuth, async (req, res) => {
    const body = parse(answerBody, req.body ?? {});
    const view = await answerErrand(
      { ...deps, logger: req.log ?? deps.logger },
      authOf(req).user.id,
      String(req.params['id']),
      body,
    );
    res.json(view);
  });

  router.post('/errands/:id/cancel', requireAuth, async (req, res) => {
    const view = await cancelErrand(
      { ...deps, logger: req.log ?? deps.logger },
      authOf(req).user.id,
      String(req.params['id']),
    );
    if (!view) throw new ApiError(404, 'not_found', 'No such errand');
    res.json(view);
  });

  return router;
}
