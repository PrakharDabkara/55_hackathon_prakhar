import { Router } from 'express';
import type { Queryable } from '../../db/queryable.js';
import { createRequireAdmin } from '../identity/index.js';

export interface ErrandStats {
  windowHours: number;
  total: number;
  byState: Record<string, number>;
  /** Over finished errands (PLAN_READY, FAILED, EXPIRED, CANCELLED). */
  avgSteps: number;
  avgTokens: number;
  /** Over finished errands that waited for shops at all. */
  avgWaitMs: number;
  /** Creation to the last change, over finished errands. */
  p95DurationMs: number;
  /** Items of finished plans by how the server marked them. */
  items: { confirmed: number; likely: number; notFound: number };
  /** Of the confirmed + likely items, the share that was confirmed (and the share that was likely). */
  confirmedPct: number;
  likelyPct: number;
}

const FINISHED = `state IN ('PLAN_READY', 'FAILED', 'EXPIRED', 'CANCELLED')`;

/** How errands are doing (admin only). All numbers are 0, never NaN, with nothing to count. */
export async function errandStats(
  db: Queryable,
  { hours = 24 }: { hours?: number } = {},
): Promise<ErrandStats> {
  const window = `created_at > now() - make_interval(hours => $1::int)`;
  const states = await db.query<{ state: string; n: number }>(
    `SELECT state, count(*)::int AS n FROM errands WHERE ${window} GROUP BY state`,
    [hours],
  );
  const finished = await db.query<{
    avg_steps: number;
    avg_tokens: number;
    avg_wait: number;
    p95: number;
  }>(
    `SELECT coalesce(avg(step_count), 0)::float AS avg_steps,
            coalesce(avg(tokens_in + tokens_out), 0)::float AS avg_tokens,
            coalesce(avg(waited_ms) FILTER (WHERE waited_ms > 0), 0)::float AS avg_wait,
            coalesce(percentile_cont(0.95) WITHIN GROUP (
              ORDER BY extract(epoch FROM updated_at - created_at) * 1000), 0)::float AS p95
       FROM errands WHERE ${window} AND ${FINISHED}`,
    [hours],
  );
  const items = await db.query<{ status: string; n: number }>(
    `SELECT i->>'status' AS status, count(*)::int AS n
       FROM errands e, jsonb_array_elements(e.plan->'items') AS i
      WHERE e.created_at > now() - make_interval(hours => $1::int)
        AND e.state = 'PLAN_READY' AND jsonb_typeof(e.plan->'items') = 'array'
      GROUP BY 1`,
    [hours],
  );
  const count = (status: string) => items.rows.find((r) => r.status === status)?.n ?? 0;
  const confirmed = count('confirmed');
  const likely = count('likely');
  const found = confirmed + likely;
  const f = finished.rows[0];
  return {
    windowHours: hours,
    total: states.rows.reduce((sum, r) => sum + r.n, 0),
    byState: Object.fromEntries(states.rows.map((r) => [r.state, r.n])),
    avgSteps: f?.avg_steps ?? 0,
    avgTokens: f?.avg_tokens ?? 0,
    avgWaitMs: f?.avg_wait ?? 0,
    p95DurationMs: f?.p95 ?? 0,
    items: { confirmed, likely, notFound: count('not_found') },
    confirmedPct: found === 0 ? 0 : (confirmed / found) * 100,
    likelyPct: found === 0 ? 0 : (likely / found) * 100,
  };
}

/** `GET /admin/errands/stats?hours=24`. Admin only; 404 for everyone else (as the other admin routes). */
export function errandsAdminRouter({
  db,
  adminToken,
}: {
  db: Queryable;
  adminToken: string;
}): Router {
  const router = Router();
  router.get('/admin/errands/stats', createRequireAdmin(adminToken), async (req, res) => {
    const asked = Number(req.query['hours']);
    const hours = Number.isInteger(asked) && asked >= 1 && asked <= 24 * 90 ? asked : 24;
    res.json(await errandStats(db, { hours }));
  });
  return router;
}
