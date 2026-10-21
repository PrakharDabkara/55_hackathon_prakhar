import { Router } from 'express';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import {
  answerListPing,
  getList,
  listShopParchis,
  orderFromList,
  sendList,
  sortList,
  stopList,
  type ListsContext,
} from './service.js';

const sortBody = z.object({ lines: z.array(z.string().max(1000)).max(100) });

const choice = z
  .object({
    position: z.number().int().min(0).max(9),
    itemId: z.uuid().optional(),
    asTyped: z.literal(true).optional(),
  })
  .refine((c) => (c.itemId === undefined) !== (c.asTyped === undefined), {
    message: 'give an itemId or asTyped, not both',
  });

const sendBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(1).max(5000).optional(),
  wantsDelivery: z.boolean().optional(),
  deliveryAddressId: z.uuid().optional(),
  choices: z.array(choice).max(10).optional(),
});

const orderBody = z.object({
  assignments: z
    .array(z.object({ position: z.number().int().min(0).max(9), shopId: z.uuid() }))
    .max(10),
  modes: z.record(z.uuid(), z.enum(['pickup', 'delivery'])).default({}),
  addressText: z.string().trim().min(5).max(300).optional(),
  customerName: z.string().trim().max(60).optional(),
  saveAddress: z.boolean().optional(),
  note: z.string().trim().max(140).optional(),
});

/** Whole rupees: the shop types a number, we keep paise. */
const answerBody = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.uuid(),
        have: z.boolean(),
        priceRupees: z.number().int().min(0).max(100_000).optional(),
      }),
    )
    .max(10),
  canDeliver: z.boolean().optional(),
  deliveryFeeRupees: z.number().int().min(0).max(10_000).optional(),
});

/**
 * Shopping lists (ADR-0055). The customer sorts, sends, watches, stops and orders; the shop reads
 * its parchis and answers. Every customer route is the owner's alone; anyone else gets 404.
 */
export function listsRouter(deps: ListsContext): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.db);
  const seekerOnly = [requireAuth, requireRole('seeker')];
  const shopOnly = [requireAuth, requireRole('shop')];
  const ctxFor = (log: ListsContext['logger'] | undefined): ListsContext => ({
    ...deps,
    logger: log ?? deps.logger,
  });
  const notFound = () => new ApiError(404, 'not_found', 'No such list');

  router.post('/lists/sort', ...seekerOnly, async (req, res) => {
    const { lines } = parse(sortBody, req.body);
    res
      .status(201)
      .json(await sortList(ctxFor(req.log), authOf(req).user.id, lines, String(req.id)));
  });

  router.get('/lists/:id', ...seekerOnly, async (req, res) => {
    const list = await getList(ctxFor(req.log), authOf(req).user.id, String(req.params['id']));
    if (!list) throw notFound();
    res.json(list);
  });

  router.post('/lists/:id/send', ...seekerOnly, async (req, res) => {
    const body = parse(sendBody, req.body);
    const list = await sendList(ctxFor(req.log), authOf(req).user.id, String(req.params['id']), {
      ...body,
      ...(body.choices && {
        choices: body.choices.map((c) => ({
          position: c.position,
          itemId: c.itemId,
          asTyped: c.asTyped,
        })),
      }),
    });
    if (!list) throw notFound();
    res.json(list);
  });

  router.post('/lists/:id/stop', ...seekerOnly, async (req, res) => {
    const list = await stopList(ctxFor(req.log), authOf(req).user.id, String(req.params['id']));
    if (!list) throw notFound();
    res.json(list);
  });

  router.post('/lists/:id/order', ...seekerOnly, async (req, res) => {
    const body = parse(orderBody, req.body);
    const result = await orderFromList(
      ctxFor(req.log),
      authOf(req).user.id,
      String(req.params['id']),
      body,
    );
    if (!result) throw notFound();
    res.status(201).json(result);
  });

  // Shop side: the parchis waiting for this shop, and its one answer to each.
  router.get('/shops/me/lists', ...shopOnly, async (req, res) => {
    res.json(await listShopParchis(deps.db, authOf(req).user.id));
  });

  router.post('/list-pings/:id/answer', ...shopOnly, async (req, res) => {
    const input = parse(answerBody, req.body);
    const answer = await answerListPing(
      ctxFor(req.log),
      authOf(req).user.id,
      String(req.params['id']),
      input,
    );
    if (!answer) throw new ApiError(404, 'not_found', 'No such parchi');
    res.json(answer);
  });

  return router;
}
