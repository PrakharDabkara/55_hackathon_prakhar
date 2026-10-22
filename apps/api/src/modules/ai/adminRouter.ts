import { Router } from 'express';
import { ApiError } from '../../http/errors.js';
import type { Queryable } from '../../db/queryable.js';
import { createRequireAdmin } from '../identity/index.js';
import type { AiContext } from './index.js';

interface Window {
  queries: number;
  byStep: Record<'cache' | 'synonym' | 'trigram' | 'embedding' | 'llm' | 'unresolved', number>;
  llmFallbackRate: number;
  cacheHitRate: number;
  llm: {
    calls: number;
    avgTokensPerCall: number;
    p95LatencyMs: number;
    errors: number;
    invalidOutputs: number;
    breakerSkips: number;
  };
}

async function windowStats(db: Queryable, interval: string): Promise<Window> {
  const steps = await db.query<{ step: string | null; n: number }>(
    `SELECT matched_by AS step, count(*)::int AS n FROM search_queries
      WHERE created_at > now() - $1::interval GROUP BY matched_by`,
    [interval],
  );
  const byStep = { cache: 0, synonym: 0, trigram: 0, embedding: 0, llm: 0, unresolved: 0 };
  for (const row of steps.rows) {
    const key = (row.step ?? 'unresolved') as keyof typeof byStep;
    if (key in byStep) byStep[key] += row.n;
  }
  const queries = Object.values(byStep).reduce((a, b) => a + b, 0);

  const { rows } = await db.query<{
    calls: number;
    tokens: number;
    p95: number | null;
    errors: number;
    invalid: number;
    skipped: number;
    attempts: number;
  }>(
    `SELECT count(*) FILTER (WHERE outcome <> 'breaker')::int AS calls,
            coalesce(avg(input_tokens + output_tokens) FILTER (WHERE outcome = 'ok'), 0)::float AS tokens,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
              FILTER (WHERE outcome IN ('ok', 'invalid_output')) AS p95,
            count(*) FILTER (WHERE outcome IN ('timeout', 'http', 'network', 'other'))::int AS errors,
            count(*) FILTER (WHERE outcome = 'invalid_output')::int AS invalid,
            count(*) FILTER (WHERE outcome = 'breaker')::int AS skipped,
            count(*)::int AS attempts
       FROM ai_calls WHERE purpose = 'resolve_query' AND created_at > now() - $1::interval`,
    [interval],
  );
  const llm = rows[0];
  return {
    queries,
    byStep,
    // Queries that reached the LLM step (answered, failed or skipped), over all queries.
    llmFallbackRate: queries === 0 ? 0 : Math.min(1, (llm?.attempts ?? 0) / queries),
    cacheHitRate: queries === 0 ? 0 : byStep.cache / queries,
    llm: {
      calls: llm?.calls ?? 0,
      avgTokensPerCall: Math.round(llm?.tokens ?? 0),
      p95LatencyMs: Math.round(llm?.p95 ?? 0),
      errors: llm?.errors ?? 0,
      invalidOutputs: llm?.invalid ?? 0,
      breakerSkips: llm?.skipped ?? 0,
    },
  };
}

/** `GET /admin/ai/stats`: how the resolution pipeline is doing. Admin only; 404 for everyone else. */
export function aiAdminRouter({
  db,
  adminToken,
  ai,
}: {
  db: Queryable;
  adminToken: string;
  ai?: AiContext | undefined;
}): Router {
  const router = Router();
  router.get('/admin/ai/stats', createRequireAdmin(adminToken), async (_req, res) => {
    const [day, week] = await Promise.all([windowStats(db, '24 hours'), windowStats(db, '7 days')]);
    res.json({ '24h': day, '7d': week });
  });

  // The demo-day check: is the model up, which model, how fast, and if not, why.
  router.get('/admin/ai/ping', createRequireAdmin(adminToken), async (_req, res) => {
    if (!ai) throw new ApiError(503, 'ai_not_configured', 'No AI provider is configured');
    const results = await ai.ping();
    res.json({ provider: ai.client.providerName, ok: results.every((r) => r.ok), results });
  });
  return router;
}
