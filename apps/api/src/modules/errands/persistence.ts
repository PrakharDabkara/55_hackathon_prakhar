import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import { errandTransition, type ErrandState } from './stateMachine.js';

export interface ErrandRecord {
  id: string;
  userId: string;
  task: string;
  lat: number;
  lng: number;
  budgetPaise: number | null;
  state: ErrandState;
  version: number;
  stepCount: number;
  tokensIn: number;
  tokensOut: number;
  plan: unknown;
  failureReason: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Row {
  id: string;
  user_id: string;
  task: string;
  lat: number;
  lng: number;
  budget_paise: number | null;
  state: ErrandState;
  version: number;
  step_count: number;
  tokens_in: number;
  tokens_out: number;
  plan: unknown;
  failure_reason: string | null;
  request_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT id, user_id, task, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       budget_paise, state, version, step_count, tokens_in, tokens_out, plan, failure_reason,
       request_id, created_at, updated_at
  FROM errands`;

const toRecord = (r: Row): ErrandRecord => ({
  id: r.id,
  userId: r.user_id,
  task: r.task,
  lat: r.lat,
  lng: r.lng,
  budgetPaise: r.budget_paise,
  state: r.state,
  version: r.version,
  stepCount: r.step_count,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  plan: r.plan,
  failureReason: r.failure_reason,
  requestId: r.request_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export async function findErrand(db: Queryable, id: string): Promise<ErrandRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<Row>(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function insertErrand(
  db: Database,
  input: {
    userId: string;
    task: string;
    lat: number;
    lng: number;
    budgetPaise: number | null;
    requestId: string | null;
    hourlyLimit: number;
  },
): Promise<{ kind: 'created'; id: string } | { kind: 'rate_limited' }> {
  return withTransaction(db, async (tx) => {
    // The count and the insert must not interleave for one user, or two requests could both pass.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`errand-limit:${input.userId}`]);
    const recent = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM errands
        WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [input.userId],
    );
    if ((recent.rows[0]?.n ?? 0) >= input.hourlyLimit) return { kind: 'rate_limited' as const };
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO errands (user_id, task, location, budget_paise, request_id)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6)
       RETURNING id`,
      [input.userId, input.task, input.lat, input.lng, input.budgetPaise, input.requestId],
    );
    return { kind: 'created' as const, id: (rows[0] as { id: string }).id };
  });
}

/** How long a run owns an errand before another may take over; renewed on every step. */
export const LEASE_SECONDS = 120;

export type Claim = 'claimed' | 'busy' | 'skipped' | 'not_found';

/**
 * Takes the errand for one run: one UPDATE that succeeds only while it is PLANNING and nobody
 * holds a live lease. Of two jobs started together exactly one gets it. A lease that ran out
 * means a run died halfway; its half-written log is cleared and the run starts over.
 */
export async function claimErrand(db: Database, id: string): Promise<Claim> {
  if (!isUuid(id)) return 'not_found';
  return withTransaction(db, async (tx) => {
    const claimed = await tx.query<{ step_count: number }>(
      `UPDATE errands
          SET lease_until = now() + make_interval(secs => $2), updated_at = now()
        WHERE id = $1 AND state = 'PLANNING' AND (lease_until IS NULL OR lease_until <= now())
        RETURNING step_count`,
      [id, LEASE_SECONDS],
    );
    if (claimed.rows[0]) {
      if (claimed.rows[0].step_count > 0) {
        await tx.query(`DELETE FROM errand_steps WHERE errand_id = $1`, [id]);
        await tx.query(
          `UPDATE errands SET step_count = 0, tokens_in = 0, tokens_out = 0 WHERE id = $1`,
          [id],
        );
      }
      return 'claimed' as const;
    }
    const current = await tx.query<{ state: ErrandState }>(
      `SELECT state FROM errands WHERE id = $1`,
      [id],
    );
    if (!current.rows[0]) return 'not_found' as const;
    return current.rows[0].state === 'PLANNING' ? ('busy' as const) : ('skipped' as const);
  });
}

/** Extends the lease. False means the errand is no longer ours (finished, or taken over). */
export async function renewLease(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE errands SET lease_until = now() + make_interval(secs => $2)
      WHERE id = $1 AND state = 'PLANNING'`,
    [id, LEASE_SECONDS],
  );
  return (rowCount ?? 0) > 0;
}

export interface StepInput {
  kind: 'model' | 'tool';
  toolName?: string | null;
  args?: unknown;
  resultSummary?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

/** Appends one step and adds its tokens to the errand, in one transaction. Returns the step number. */
export async function recordStep(db: Database, errandId: string, step: StepInput): Promise<number> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ step_count: number }>(
      `UPDATE errands
          SET step_count = step_count + 1, tokens_in = tokens_in + $2, tokens_out = tokens_out + $3,
              updated_at = now()
        WHERE id = $1 RETURNING step_count`,
      [errandId, step.tokensIn ?? 0, step.tokensOut ?? 0],
    );
    const n = (rows[0] as { step_count: number }).step_count;
    await tx.query(
      `INSERT INTO errand_steps (errand_id, n, kind, tool_name, args, result_summary, tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        errandId,
        n,
        step.kind,
        step.toolName ?? null,
        JSON.stringify(step.args ?? {}),
        JSON.stringify(step.resultSummary ?? {}),
        (step.tokensIn ?? 0) + (step.tokensOut ?? 0),
        Math.round(step.latencyMs ?? 0),
      ],
    );
    return n;
  });
}

export interface StepRecord {
  n: number;
  kind: 'model' | 'tool';
  toolName: string | null;
  args: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  tokens: number;
  latencyMs: number;
  at: Date;
}

export async function listSteps(db: Queryable, errandId: string): Promise<StepRecord[]> {
  const { rows } = await db.query<{
    n: number;
    kind: 'model' | 'tool';
    tool_name: string | null;
    args: Record<string, unknown>;
    result_summary: Record<string, unknown>;
    tokens: number;
    latency_ms: number;
    at: Date;
  }>(
    `SELECT n, kind, tool_name, args, result_summary, tokens, latency_ms, at
       FROM errand_steps WHERE errand_id = $1 ORDER BY n`,
    [errandId],
  );
  return rows.map((r) => ({
    n: r.n,
    kind: r.kind,
    toolName: r.tool_name,
    args: r.args,
    resultSummary: r.result_summary,
    tokens: r.tokens,
    latencyMs: r.latency_ms,
    at: r.at,
  }));
}

export type Outcome =
  | { event: 'PLAN_SUBMITTED'; plan: unknown }
  | { event: 'RUN_FAILED'; reason: string; plan?: unknown };

export type MoveResult =
  /** This call moved the errand. */
  | { kind: 'applied'; to: ErrandState }
  /** Nothing moved: someone else got there first, or the errand has already ended. */
  | { kind: 'unchanged' }
  | { kind: 'not_found' };

/**
 * Moves an errand with one UPDATE guarded by the state we read (`WHERE state = $from`), as for
 * requests: of two racing moves exactly one updates the row, the other updates nothing.
 */
export async function moveErrand(db: Queryable, id: string, outcome: Outcome): Promise<MoveResult> {
  const current = await findErrand(db, id);
  if (!current) return { kind: 'not_found' };
  const result = errandTransition(current.state, outcome.event);
  if (!result.ok) return { kind: 'unchanged' };

  const moved = await db.query(
    `UPDATE errands
        SET state = $2, version = version + 1, plan = COALESCE($3::jsonb, plan),
            failure_reason = $4, lease_until = NULL, updated_at = now()
      WHERE id = $1 AND state = $5
      RETURNING id`,
    [
      id,
      result.to,
      outcome.plan === undefined ? null : JSON.stringify(outcome.plan),
      outcome.event === 'RUN_FAILED' ? outcome.reason : null,
      current.state,
    ],
  );
  return moved.rows.length > 0 ? { kind: 'applied', to: result.to } : { kind: 'unchanged' };
}
