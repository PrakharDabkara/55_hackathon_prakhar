import { Router } from 'express';
import type { Logger } from 'pino';
import type { Queryable } from '../db/queryable.js';

interface HealthDeps {
  gitSha: string;
  db: Queryable;
  logger: Logger;
  readyTimeoutMs: number;
}

/** Liveness (`/health`, no dependencies) and readiness (`/ready`, checks Postgres). */
export function healthRouter({ gitSha, db, logger, readyTimeoutMs }: HealthDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', sha: gitSha, uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/ready', async (req, res) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('readiness check timed out')), readyTimeoutMs);
      });
      await Promise.race([db.query('SELECT 1'), timeout]);
      res.json({ status: 'ok' });
    } catch (err) {
      // The cause goes to the log only; the response must not leak connection details.
      (req.log ?? logger).error({ err }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
}
