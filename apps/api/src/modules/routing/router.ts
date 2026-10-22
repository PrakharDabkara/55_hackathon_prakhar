import { Router } from 'express';
import { z } from 'zod';
import type { Queryable } from '../../db/queryable.js';
import { parse } from '../../http/errors.js';
import { createRequireAuth } from '../identity/index.js';
import { planRoute } from './plan.js';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** The plan_route tool's input (packages/shared), strict all the way down: nothing unknown, no long ids. */
const planBody = z.strictObject({
  start: z.strictObject({ lat, lng }),
  stops: z
    .array(
      z.strictObject({
        shopId: z.string().min(1).max(64),
        lat,
        lng,
        label: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(8),
});

/** `POST /route/plan`: the order to visit up to 8 shops in, by walking distance. Needs a login. */
export function routingRouter({ db }: { db: Queryable }): Router {
  const router = Router();
  router.post('/route/plan', createRequireAuth(db), (req, res) => {
    const { start, stops } = parse(planBody, req.body);
    const plan = planRoute(start, stops);
    // Whole metres are plenty for a walk, and the total is the sum of what is shown.
    const legsM = plan.legsM.map(Math.round);
    res.json({
      orderedStops: plan.orderedStops,
      legsM,
      totalM: legsM.reduce((a, b) => a + b, 0),
    });
  });
  return router;
}
