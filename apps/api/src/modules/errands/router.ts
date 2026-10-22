import { Router } from 'express';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import {
  answerErrand,
  cancelErrand,
  chooseDeliveryMode,
  createErrand,
  getErrand,
  type ErrandsContext,
} from './service.js';
import { listRecentErrands } from './persistence.js';

const RECENT_LIMIT = 20;

export function errandsRouter(deps: ErrandsContext): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.db);
  const createBody = z.strictObject({
    task: z.string().trim().min(1).max(deps.limits.taskMaxChars),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    budgetPaise: z.number().int().min(1).max(10_000_000).optional(),
    /** "Deliver to me" (ADR-0039): every request the errand opens inherits it, set by code. */
    wantsDelivery: z.boolean().optional(),
    deliveryAddressId: z.uuid().optional(),
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

  // The customer's last errands, for "Haal ke kaam".
  router.get('/errands', requireAuth, requireRole('seeker'), async (req, res) => {
    res.json(await listRecentErrands(deps.db, authOf(req).user.id, RECENT_LIMIT));
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

  // Owner only: pickup or delivery for one shop of the finished plan (ADR-0031).
  const modeBody = z.strictObject({ shopId: z.uuid(), mode: z.enum(['pickup', 'delivery']) });
  router.post('/errands/:id/modes', requireAuth, requireRole('seeker'), async (req, res) => {
    const { shopId, mode } = parse(modeBody, req.body);
    const view = await chooseDeliveryMode(
      { ...deps, logger: req.log ?? deps.logger },
      authOf(req).user.id,
      String(req.params['id']),
      shopId,
      mode,
    );
    if (!view) throw new ApiError(404, 'not_found', 'No such errand');
    res.json(view);
  });

  // Owner only. Exactly one of text, optionIndex or selected (selected may carry text); checked in the service so every caller gets the same rules.
  const answerBody = z.strictObject({
    text: z.string().max(deps.limits.taskMaxChars).optional(),
    optionIndex: z.number().int().min(0).max(10).optional(),
    /** For a multi-select question: the indexes of the ticked options; `text` is then "Kuch aur?". */
    selected: z.array(z.number().int().min(0).max(10)).max(10).optional(),
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
