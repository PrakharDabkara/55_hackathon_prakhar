import { Router } from 'express';
import { z } from 'zod';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth, requireRole } from '../identity/index.js';
import { answerPickup, listPendingPickups, recordPickup, type PickupsContext } from './service.js';

const newBody = z
  .object({
    shopId: z.uuid(),
    itemId: z.uuid(),
    requestId: z.uuid().optional(),
    errandId: z.uuid().optional(),
  })
  .refine((b) => (b.requestId === undefined) !== (b.errandId === undefined), {
    message: 'give a requestId or an errandId, not both',
  });
const answerBody = z.object({ answer: z.enum(['found', 'not_there', 'not_gone']) });

/**
 * "Le liya?" (ADR-0035). Customers only, and only their own visits; the shop side has no route
 * here at all, so there is nothing a shop could read about who reported.
 */
export function pickupsRouter(ctx: PickupsContext): Router {
  const router = Router();
  const seekerOnly = [createRequireAuth(ctx.db), requireRole('seeker')];
  const scoped = (req: Parameters<typeof authOf>[0]): PickupsContext => ({
    ...ctx,
    logger: req.log ?? ctx.logger,
  });

  router.post('/pickups', ...seekerOnly, async (req, res) => {
    await recordPickup(scoped(req), authOf(req).user.id, parse(newBody, req.body));
    res.status(204).end();
  });

  router.get('/pickups/pending', ...seekerOnly, async (req, res) => {
    res.json(await listPendingPickups(scoped(req), authOf(req).user.id));
  });

  router.post('/pickups/:id/answer', ...seekerOnly, async (req, res) => {
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw new ApiError(404, 'not_found', 'No such question');
    const { answer } = parse(answerBody, req.body);
    await answerPickup(scoped(req), authOf(req).user.id, id.data, answer);
    res.status(204).end();
  });

  return router;
}
