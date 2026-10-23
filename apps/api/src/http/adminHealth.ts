import { Router } from 'express';
import type { Queryable } from '../db/queryable.js';
import { createRequireAdmin } from '../modules/identity/index.js';

export interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failedLast24h: number;
}

/** What only the running process knows. Absent without Redis; every part is counts or a flag. */
export interface OpsProbes {
  redisOk(): Promise<boolean>;
  queues(): Promise<QueueDepth[]>;
  autopilot(): { on: boolean; lastActivityAt: string | null };
  /** Redis INFO memory: bytes in use and the plan's cap (0 when none is set). */
  redisMemory(): Promise<{ usedBytes: number; maxBytes: number }>;
}

const PROBE_TIMEOUT_MS = 1500;

async function within<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /admin/health/details`: the first thing to open when someone reports a problem (see
 * docs/runbook.md). Counts and flags only, never a row. Admin only; 404 for everyone else.
 */
export function adminHealthRouter({
  db,
  adminToken,
  gitSha,
  provider,
  ops,
}: {
  db: Queryable;
  adminToken: string;
  gitSha: string;
  provider: string;
  ops?: OpsProbes | undefined;
}): Router {
  const router = Router();
  router.get('/admin/health/details', createRequireAdmin(adminToken), async (_req, res) => {
    const [dbOk, ai, redisOk, queues, memory] = await Promise.all([
      within(
        db.query('SELECT 1').then(() => true),
        false,
      ),
      within(
        db
          .query<{ calls: number; failed: number; skipped: number }>(
            `SELECT count(*) FILTER (WHERE outcome <> 'breaker')::int AS calls,
                    count(*) FILTER (WHERE outcome IN ('timeout', 'http', 'network', 'other'))::int AS failed,
                    count(*) FILTER (WHERE outcome = 'breaker')::int AS skipped
               FROM ai_calls WHERE created_at >= date_trunc('day', now())`,
          )
          .then((r) => r.rows[0] ?? null),
        null,
      ),
      ops ? within(ops.redisOk(), false) : Promise.resolve(false),
      ops ? within(ops.queues(), []) : Promise.resolve([]),
      ops ? within(ops.redisMemory(), null) : Promise.resolve(null),
    ]);
    res.json({
      version: { sha: gitSha },
      db: { ok: dbOk },
      redis: ops
        ? {
            ok: redisOk,
            usedMemoryBytes: memory?.usedBytes ?? null,
            maxMemoryBytes: memory?.maxBytes ?? null,
          }
        : { ok: false, configured: false },
      queues,
      // The only AI limit is per user per hour (30); there is no daily cap to compare with, so
      // the day's counts are what shows a quota running out: failures climbing, breaker skips.
      ai: {
        provider,
        callsToday: ai?.calls ?? null,
        failedToday: ai?.failed ?? null,
        breakerSkipsToday: ai?.skipped ?? null,
      },
      autopilot: ops?.autopilot() ?? { on: false, lastActivityAt: null },
    });
  });
  return router;
}
