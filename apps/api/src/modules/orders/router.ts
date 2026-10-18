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
  listShopOrders,
  placeOrder,
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
    addressText: z.string().trim().min(5).max(300),
    customerName: z.string().trim().max(60).optional(),
    saveAddress: z.boolean().optional(),
  })
  .refine((b) => (b.requestId === undefined) !== (b.errandId === undefined), {
    message: 'give a requestId or an errandId, not both',
  });

// Neither: all of the customer's orders (Mere orders). One of them: the orders of that screen.
const sourceQuery = z
  .object({ requestId: z.uuid().optional(), errandId: z.uuid().optional() })
  .refine((q) => q.requestId === undefined || q.errandId === undefined, {
    message: 'give a requestId or an errandId, not both',
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
    if (q.requestId === undefined && q.errandId === undefined) {
      res.json(await listMyOrders(ctxFor(req), authOf(req).user.id));
      return;
    }
    const source = q.requestId ? { requestId: q.requestId } : { errandId: q.errandId as string };
    res.json(await listSeekerOrders(ctxFor(req), authOf(req).user.id, source));
  });

  // Before /orders/:id, so "saved-address" is not read as an id.
  router.get('/orders/saved-address', ...seekerOnly, async (req, res) => {
    res.json(await savedAddress(ctxFor(req), authOf(req).user.id));
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

  router.post('/orders/:id/cancel', ...seekerOnly, async (req, res) => {
    res.json(await cancelOrder(ctxFor(req), authOf(req).user.id, orderId(req)));
  });

  router.get('/shops/me/orders', ...shopOnly, async (req, res) => {
    res.json(await listShopOrders(ctxFor(req), authOf(req).user.id));
  });

  for (const verb of ['accept', 'decline', 'out', 'delivered'] as const satisfies ShopVerb[]) {
    router.post(`/orders/:id/${verb}`, ...shopOnly, async (req, res) => {
      res.json(await shopAct(ctxFor(req), authOf(req).user.id, orderId(req), verb));
    });
  }

  return router;
}
