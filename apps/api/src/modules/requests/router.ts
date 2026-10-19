import { Router } from 'express';
import { QUANTITY_UNITS } from '@kahanmilega/shared';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import { answerPing, listShopPings } from './pings.js';
import {
  closeRequest,
  createRequest,
  getRequestStatus,
  listRecentRequests,
  type RequestsContext,
} from './service.js';

const RECENT_LIMIT = 10;

const createBody = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusM: z.number().int().min(1).max(5000).optional(),
    targetPricePaise: z.number().int().min(1).max(10_000_000).optional(),
    itemId: z.uuid().optional(),
    /** What the customer did with the "Kya aapka matlab…?" question (a metric only, ADR-0036). */
    understanding: z.enum(['confirmed', 'changed']).optional(),
    /** An optional photo of what is wanted: one the customer uploaded and has not used (ADR-0030). */
    photoId: z.uuid().optional(),
  })
  .refine((v) => v.q !== undefined || v.itemId !== undefined, {
    message: 'q: give the text to look for, or an itemId',
    path: ['q'],
  });

const viewQuery = z.object({ sort: z.enum(['distance', 'price']).optional() });

const answerBody = z.object({
  answer: z.enum(['yes', 'no']),
  pricePaise: z.number().int().min(0).max(10_000_000).optional(),
  quantityHint: z.enum(['few', 'plenty']).optional(),
  /** An optional photo of the item, only with a yes. */
  photoId: z.uuid().optional(),
  /** An exact quantity next to the price, only with a yes (ADR-0031). */
  quantity: z
    .object({ amount: z.number().positive().max(100_000), unit: z.enum(QUANTITY_UNITS) })
    .strict()
    .optional(),
  /** "Ghar bhej denge": present means the shop delivers; a fee and a time are optional. */
  delivery: z
    .object({
      feePaise: z.number().int().min(0).max(1_000_000).optional(),
      minutes: z.number().int().min(1).max(1440).optional(),
    })
    .strict()
    .optional(),
});

const idempotencyKey = z.string().trim().min(1).max(128);

export function requestsRouter(deps: RequestsContext): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.db);
  // The HTTP logger carries the request id, so transition lines join the search that caused them.
  const ctxFor = (log: RequestsContext['logger'] | undefined): RequestsContext => ({
    ...deps,
    logger: log ?? deps.logger,
  });

  router.post('/requests', requireAuth, requireRole('seeker'), async (req, res) => {
    const body = parse(createBody, req.body);
    const header = req.header('idempotency-key');
    const key = header === undefined ? undefined : parse(idempotencyKey, header);
    const { created, request } = await createRequest(ctxFor(req.log), authOf(req).user.id, {
      ...body,
      q: body.q ?? '',
      requestId: String(req.id),
      ...(key && { idempotencyKey: key }),
    });
    res.status(created ? 201 : 200).json(request);
  });

  // The customer's last searches, for "Haal ke kaam".
  router.get('/requests', requireAuth, requireRole('seeker'), async (req, res) => {
    res.json(await listRecentRequests(deps.db, authOf(req).user.id, RECENT_LIMIT));
  });

  router.get('/requests/:id', requireAuth, async (req, res) => {
    const { sort } = parse(viewQuery, req.query);
    const request = await getRequestStatus(
      ctxFor(req.log),
      authOf(req).user.id,
      String(req.params['id']),
      { sort },
    );
    if (!request) throw new ApiError(404, 'not_found', 'No such request');
    res.json(request);
  });

  router.post('/requests/:id/close', requireAuth, async (req, res) => {
    const request = await closeRequest(
      ctxFor(req.log),
      authOf(req).user.id,
      String(req.params['id']),
    );
    if (!request) throw new ApiError(404, 'not_found', 'No such request');
    res.json(request);
  });

  // Shop side: the pings waiting for this shop, and its one-tap answer.
  router.get('/shops/me/pings', requireAuth, requireRole('shop'), async (req, res) => {
    res.json(await listShopPings(deps.db, authOf(req).user.id));
  });

  router.post('/pings/:id/answer', requireAuth, requireRole('shop'), async (req, res) => {
    const input = parse(answerBody, req.body);
    const answer = await answerPing(
      ctxFor(req.log),
      authOf(req).user.id,
      String(req.params['id']),
      input,
    );
    if (!answer) throw new ApiError(404, 'not_found', 'No such ping');
    res.json(answer);
  });

  return router;
}
