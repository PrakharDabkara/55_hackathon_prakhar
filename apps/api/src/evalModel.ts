import type { Queryable } from './db/queryable.js';
import { FALLBACK_DEFAULT, PRIMARY_DEFAULT } from './evalErrand/model.js';

/**
 * The environment of a resolve eval run. "primary" is GEMINI_MODEL; "fallback" runs query
 * resolution on the fallback model (GEMINI_FALLBACK_MODEL, default gemini-3.5-flash-lite). The
 * automatic failover is switched off, so a run measures one model: a 429 or a retired model must
 * show up as an error in the report, not as another model's quietly better answers (ADR-0065).
 */
export function resolveEvalEnv(
  env: Record<string, string | undefined>,
  which: 'primary' | 'fallback',
): Record<string, string | undefined> {
  const chosen =
    which === 'fallback'
      ? (env['GEMINI_FALLBACK_MODEL'] ?? FALLBACK_DEFAULT)
      : (env['GEMINI_MODEL'] ?? PRIMARY_DEFAULT);
  const out: Record<string, string | undefined> = { ...env, GEMINI_MODEL: chosen };
  delete out['GEMINI_FALLBACK_MODEL'];
  delete out['GEMINI_ERRAND_FALLBACK_MODEL'];
  return out;
}

export interface ModelUse {
  purpose: string;
  model: string;
  n: number;
}

/**
 * Second line of defence, behind the switched-off failover: every successful call of a pinned
 * purpose must have been answered by the model under test. Returns one message per violation.
 */
export function foreignModels(rows: ModelUse[], expected: Record<string, string>): string[] {
  return rows
    .filter((r) => expected[r.purpose] !== undefined && r.model !== expected[r.purpose])
    .map(
      (r) =>
        `${r.n} ${r.purpose} call(s) were answered by ${r.model}, not the model under test (${expected[r.purpose]})`,
    );
}

/** Reads ai_calls of the run and reports every call answered by another model than expected. */
export async function pinnedModelViolations(
  db: Queryable,
  expected: Record<string, string>,
): Promise<string[]> {
  const { rows } = await db.query<ModelUse>(
    `SELECT purpose, model, count(*)::int AS n FROM ai_calls
      WHERE outcome = 'ok' GROUP BY purpose, model`,
  );
  return foreignModels(rows, expected);
}
