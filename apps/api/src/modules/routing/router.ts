import { planRouteTool } from '@kahanmilega/shared/tools';
import { Router } from 'express';
import type { Queryable } from '../../db/queryable.js';
import { parse } from '../../http/errors.js';
import { createRequireAuth } from '../identity/index.js';
import { planRoute } from './plan.js';

/** `POST /route/plan`: the order to visit up to 8 shops in, by walking distance. Needs a login. */
export function routingRouter({ db }: { db: Queryable }): Router {
  const router = Router();
  router.post('/route/plan', createRequireAuth(db), (req, res) => {
    const { start, stops } = parse(planRouteTool.input, req.body);
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
