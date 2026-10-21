import { Router } from 'express';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import {
  cancelOrder,
  forgetAddress,
  getSeekerOrder,
  listMyOrders,
  listSeekerOrders,
  packLine,
  listShopOrders,
  keepAddress,
  placeOrder,
  receiveOrder,
  savedAddress,
  shopAct,
  type OrdersContext,
  type ShopVerb,
} from './service.js';
import { seekerOrderView } from './view.js';

const placeBody = z
  .object({
    shopId: z.uuid(),
    requestId: z.uuid().optional(),
    errandId: z.uuid().optional(),
    addressText: z.string().trim().min(5).max(300).optional(),
    customerName: z.string().trim().max(60).optional(),
    saveAddress: z.boolean().optional(),
    note: z.string().trim().max(140).optional(),
  })
  .refine((b) => (b.requestId === undefined) !== (b.errandId === undefined), {
    message: 'give a requestId or an errandId, not both',
  });

// Neither: all of the customer's orders (Mere orders). One of them: the orders of that screen.
const sourceQuery = z
  .object({
    requestId: z.uuid().optional(),
    errandId: z.uuid().optional(),
    listId: z.uuid().optional(),
  })
  .refine((q) => [q.requestId, q.errandId, q.listId].filter((v) => v !== undefined).length <= 1, {
    message: 'give a requestId, an errandId or a listId, only one',
  });

/**
 * Delivery orders (ADR-0031). Cash on delivery. The customer places and follows an order; the
 * shop's owner answers and moves it. Every customer route is the owner's alone, every shop route
 * the shop owner's alone; anyone else gets 404 for an order they do not own.
 */
export function ordersRouter(deps: OrdersContext): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.db);
  const seekerOnly = [requireAuth, requireRole('seeker')];
  const shopOnly = [requireAuth, requireRole('shop')];
  const ctxFor = (req: Parameters<typeof authOf>[0]): OrdersContext => ({
    ...deps,
    logger: req.log ?? deps.logger,
  });

  router.post('/orders', ...seekerOnly, async (req, res) => {
    const body = parse(placeBody, req.body);
    const { order, created } = await placeOrder(ctxFor(req), authOf(req).user.id, body);
    res.status(created ? 201 : 200).json(seekerOrderView(order));
  });

  router.get('/orders', ...seekerOnly, async (req, res) => {
    const q = parse(sourceQuery, req.query);
    if (q.requestId === undefined && q.errandId === undefined && q.listId === undefined) {
      res.json(await listMyOrders(ctxFor(req), authOf(req).user.id));
      return;
    }
    const source = q.requestId
      ? { requestId: q.requestId }
      : q.errandId
        ? { errandId: q.errandId }
        : { listId: q.listId as string };
    res.json(await listSeekerOrders(ctxFor(req), authOf(req).user.id, source));
  });

  // Before /orders/:id, so "saved-address" is not read as an id.
  router.get('/orders/saved-address', ...seekerOnly, async (req, res) => {
    res.json(await savedAddress(ctxFor(req), authOf(req).user.id));
  });

  router.put('/orders/saved-address', ...seekerOnly, async (req, res) => {
    const body = parse(
      z.object({
        addressText: z.string().trim().min(5).max(300),
        customerName: z.string().trim().max(60).optional(),
      }),
      req.body,
    );
    res.json(await keepAddress(ctxFor(req), authOf(req).user.id, body));
  });

  router.delete('/orders/saved-address', ...seekerOnly, async (req, res) => {
    await forgetAddress(ctxFor(req), authOf(req).user.id);
    res.status(204).end();
  });

  const orderId = (req: { params: Record<string, unknown> }) => {
    const id = String(req.params['id']);
    if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'not_found', 'No such order');
    return id;
  };

  router.get('/orders/:id', ...seekerOnly, async (req, res) => {
    res.json(await getSeekerOrder(ctxFor(req), authOf(req).user.id, orderId(req)));
  });

  // Either side cancels here; who the caller is to this order decides which rules apply.
  router.post('/orders/:id/cancel', requireAuth, async (req, res) => {
    const body = parse(
      z.object({
        reason: z.string().trim().max(140).optional(),
        text: z.string().trim().max(140).optional(),
      }),
      req.body ?? {},
    );
    res.json(await cancelOrder(ctxFor(req), authOf(req).user.id, orderId(req), body));
  });

  router.post('/orders/:id/received', ...seekerOnly, async (req, res) => {
    res.json(await receiveOrder(ctxFor(req), authOf(req).user.id, orderId(req)));
  });

  router.get('/shops/me/orders', ...shopOnly, async (req, res) => {
    res.json(await listShopOrders(ctxFor(req), authOf(req).user.id));
  });

  // The shop ticks a line as packed, or clears it, while the order is not final (ADR-0055).
  router.put('/orders/:id/lines/:index/packed', ...shopOnly, async (req, res) => {
    const { packed } = parse(z.object({ packed: z.boolean() }), req.body);
    const index = parse(z.coerce.number().int().min(0).max(1000), req.params['index']);
    res.json(await packLine(ctxFor(req), authOf(req).user.id, orderId(req), index, packed));
  });

  for (const verb of ['accept', 'decline', 'out'] as const satisfies ShopVerb[]) {
    router.post(`/orders/:id/${verb}`, ...shopOnly, async (req, res) => {
      res.json(await shopAct(ctxFor(req), authOf(req).user.id, orderId(req), verb));
    });
  }

  return router;
}
