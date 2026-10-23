import { Router } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { createRequireAdmin } from '../identity/index.js';
import { resetDemo, seedDemo, type DemoContext } from './service.js';

interface Deps {
  db: Database;
  logger: Logger;
  adminToken: string;
  capBytes: number;
  hooks?: DemoContext['hooks'];
}

/**
 * Admin-only demo endpoints (ADR-0062). Every refusal is the same 404 as an unknown route, so
 * nobody can tell they exist; with no ADMIN_TOKEN they are not mounted at all. Answers are counts.
 */
export function demoRouter({ db, logger, adminToken, capBytes, hooks }: Deps): Router {
  const router = Router();
  const requireAdmin = createRequireAdmin(adminToken);
  const ctxFor = (log: Logger | undefined): DemoContext => ({
    db,
    logger: log ?? logger,
    capBytes,
    hooks,
  });

  router.post('/admin/demo/seed', requireAdmin, async (req, res) => {
    res.json(await seedDemo(ctxFor(req.log)));
  });

  router.post('/admin/demo/reset', requireAdmin, async (req, res) => {
    res.json(await resetDemo(ctxFor(req.log)));
  });

  return router;
}
