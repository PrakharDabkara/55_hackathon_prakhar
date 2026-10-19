import type { ExactQuantity } from '@kahanmilega/shared';
import type { Logger } from 'pino';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import type { EventPublisher } from '../realtime/index.js';
import { errandTransition, type ErrandState } from './stateMachine.js';

export interface ErrandRecord {
  id: string;
  userId: string;
  task: string;
  lat: number;
  lng: number;
  budgetPaise: number | null;
  /** "Deliver to me" from Find: set by code onto every request the errand opens (ADR-0039). */
  wantsDelivery: boolean;
  deliveryAddressId: string | null;
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
  expiresAt: Date;
  waitedMs: number;
  waitStartedAt: Date | null;
  waitDeadline: Date | null;
  answerDeadline: Date | null;
  question: ErrandQuestion | null;
  answer: ErrandAnswer | null;
  questionsAsked: number;
  resumeReason: ResumeReason | null;
  /** The customer's pickup or delivery choice per shop (ADR-0031); a shop not listed is pickup. */
  deliveryModes: Record<string, 'pickup' | 'delivery'>;
}

/** What the agent asked the customer. */
export interface ErrandQuestion {
  question: string;
  options?: string[];
  /** The customer ticks any number of the options (a list to confirm). */
  multiSelect?: boolean;
  /** 0-based indexes of the options that start ticked. */
  preselected?: number[];
}
/** `ticked`: the options the customer ticked (and words they typed) in a checklist, as they were. */
export type ErrandAnswer = { text: string; ticked?: string[] } | { timedOut: true };
export type ResumeReason = 'replies' | 'timer' | 'answered' | 'answer_timeout';

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
  expires_at: Date;
  waited_ms: number;
  wait_started_at: Date | null;
  wait_deadline: Date | null;
  answer_deadline: Date | null;
  question: ErrandQuestion | null;
  answer: ErrandAnswer | null;
  questions_asked: number;
  resume_reason: ResumeReason | null;
  delivery_modes: Record<string, 'pickup' | 'delivery'>;
  wants_delivery: boolean;
  delivery_address_id: string | null;
}

const SELECT = `SELECT id, user_id, task, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       budget_paise, state, version, step_count, tokens_in, tokens_out, plan, failure_reason,
       request_id, created_at, updated_at, expires_at, waited_ms, wait_started_at, wait_deadline,
       answer_deadline, question, answer, questions_asked, resume_reason, delivery_modes,
       wants_delivery, delivery_address_id
  FROM errands`;

const toRecord = (r: Row): ErrandRecord => ({
  id: r.id,
  userId: r.user_id,
  task: r.task,
  lat: r.lat,
  lng: r.lng,
  budgetPaise: r.budget_paise,
  wantsDelivery: r.wants_delivery,
  deliveryAddressId: r.delivery_address_id,
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
  expiresAt: r.expires_at,
  waitedMs: r.waited_ms,
  waitStartedAt: r.wait_started_at,
  waitDeadline: r.wait_deadline,
  answerDeadline: r.answer_deadline,
  question: r.question,
  answer: r.answer,
  questionsAsked: r.questions_asked,
  resumeReason: r.resume_reason,
  deliveryModes: r.delivery_modes,
});

/** Tells the owner something changed (ADR-0018): an id and a state, never the lines themselves. */
export function announceErrand(
  events: EventPublisher | undefined,
  userId: string,
  errandId: string,
  state: ErrandState,
  log?: Logger,
): void {
  events?.publish({ to: { userId }, type: 'errand.updated', data: { errandId, state } }, log);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export async function findErrand(db: Queryable, id: string): Promise<ErrandRecord | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<Row>(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export interface RecentErrand {
  id: string;
  state: string;
  task: string;
  createdAt: Date;
}

/** The customer's latest errands, newest first (for "Haal ke kaam"). */
export async function listRecentErrands(
  db: Queryable,
  userId: string,
  limit: number,
): Promise<RecentErrand[]> {
  const { rows } = await db.query<{ id: string; state: string; task: string; created_at: Date }>(
    `SELECT id, state, task, created_at FROM errands
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({ id: r.id, state: r.state, task: r.task, createdAt: r.created_at }));
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
    wantsDelivery: boolean;
    deliveryAddressId: string | null;
    hourlyLimit: number;
    expiryMs: number;
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
      `INSERT INTO errands (user_id, task, location, budget_paise, request_id, expires_at,
                            wants_delivery, delivery_address_id)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6,
               now() + make_interval(secs => $7::float / 1000), $8, $9)
       RETURNING id`,
      [
        input.userId,
        input.task,
        input.lat,
        input.lng,
        input.budgetPaise,
        input.requestId,
        input.expiryMs,
        input.wantsDelivery,
        input.deliveryAddressId,
      ],
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
 * means a run died halfway: the next run rebuilds the conversation from the log and carries on
 * (Day 13), it does not start over.
 */
export async function claimErrand(db: Database, id: string): Promise<Claim> {
  if (!isUuid(id)) return 'not_found';
  const claimed = await db.query(
    `UPDATE errands
        SET lease_until = now() + make_interval(secs => $2), updated_at = now()
      WHERE id = $1 AND state = 'PLANNING' AND (lease_until IS NULL OR lease_until <= now())
      RETURNING id`,
    [id, LEASE_SECONDS],
  );
  if (claimed.rows[0]) return 'claimed';
  const current = await db.query<{ state: ErrandState }>(
    `SELECT state FROM errands WHERE id = $1`,
    [id],
  );
  if (!current.rows[0]) return 'not_found';
  return current.rows[0].state === 'PLANNING' ? 'busy' : 'skipped';
}

export type Lease = 'ok' | 'lost' | 'expired';

/**
 * Extends the lease. `lost`: the errand is no longer ours (finished, cancelled, or taken over).
 * `expired`: still ours but past its overall limit, so the run must end it.
 */
export async function renewLease(db: Queryable, id: string): Promise<Lease> {
  const { rows } = await db.query<{ expired: boolean }>(
    `UPDATE errands SET lease_until = now() + make_interval(secs => $2)
      WHERE id = $1 AND state = 'PLANNING'
      RETURNING (expires_at <= now()) AS expired`,
    [id, LEASE_SECONDS],
  );
  if (!rows[0]) return 'lost';
  return rows[0].expired ? 'expired' : 'ok';
}

export interface StepInput {
  kind: 'model' | 'tool' | 'note';
  toolName?: string | null;
  args?: unknown;
  resultSummary?: unknown;
  /** The message as the model saw it; this is what a resumed run rebuilds the conversation from. */
  payload?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

/**
 * Appends one step and adds its tokens to the errand, in one transaction. Returns the step
 * number. Model and tool steps count in `step_count`; notes do not. A tool step is a new
 * progress line, so the owner gets an errand.updated hint after the commit.
 */
export async function recordStep(
  db: Database,
  errandId: string,
  step: StepInput,
  events?: EventPublisher,
): Promise<number> {
  const out = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ step_seq: number; user_id: string; state: ErrandState }>(
      `UPDATE errands
          SET step_seq = step_seq + 1,
              step_count = step_count + CASE WHEN $4 THEN 0 ELSE 1 END,
              tokens_in = tokens_in + $2, tokens_out = tokens_out + $3, updated_at = now()
        WHERE id = $1 RETURNING step_seq, user_id, state`,
      [errandId, step.tokensIn ?? 0, step.tokensOut ?? 0, step.kind === 'note'],
    );
    const r = rows[0] as { step_seq: number; user_id: string; state: ErrandState };
    await tx.query(
      `INSERT INTO errand_steps (errand_id, n, kind, tool_name, args, result_summary, payload, tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        errandId,
        r.step_seq,
        step.kind,
        step.toolName ?? null,
        JSON.stringify(step.args ?? {}),
        JSON.stringify(step.resultSummary ?? {}),
        step.payload === undefined ? null : JSON.stringify(step.payload),
        (step.tokensIn ?? 0) + (step.tokensOut ?? 0),
        Math.round(step.latencyMs ?? 0),
      ],
    );
    return r;
  });
  if (step.kind === 'tool') announceErrand(events, out.user_id, errandId, out.state);
  return out.step_seq;
}

export interface StepRecord {
  n: number;
  kind: 'model' | 'tool' | 'note';
  toolName: string | null;
  args: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  payload: unknown;
  tokens: number;
  latencyMs: number;
  at: Date;
}

export async function listSteps(db: Queryable, errandId: string): Promise<StepRecord[]> {
  const { rows } = await db.query<{
    n: number;
    kind: 'model' | 'tool' | 'note';
    tool_name: string | null;
    args: Record<string, unknown>;
    result_summary: Record<string, unknown>;
    payload: unknown;
    tokens: number;
    latency_ms: number;
    at: Date;
  }>(
    `SELECT n, kind, tool_name, args, result_summary, payload, tokens, latency_ms, at
       FROM errand_steps WHERE errand_id = $1 ORDER BY n`,
    [errandId],
  );
  return rows.map((r) => ({
    n: r.n,
    kind: r.kind,
    toolName: r.tool_name,
    args: r.args,
    resultSummary: r.result_summary,
    payload: r.payload,
    tokens: r.tokens,
    latencyMs: r.latency_ms,
    at: r.at,
  }));
}

export type Outcome =
  | { event: 'PLAN_SUBMITTED'; plan: unknown }
  | { event: 'RUN_FAILED'; reason: string; plan?: unknown }
  /** Waits for shops; wakes by itself after `waitMs`. */
  | { event: 'ASKED_SHOPS'; waitMs: number }
  | { event: 'ASKED_USER'; question: ErrandQuestion; answerTimeoutMs: number }
  | { event: 'EXPIRE'; plan?: unknown }
  | { event: 'CANCEL' };

export type MoveResult =
  /** This call moved the errand. */
  | { kind: 'applied'; to: ErrandState }
  /** Nothing moved: someone else got there first, or the errand has already ended. */
  | { kind: 'unchanged' }
  | { kind: 'not_found' };

/**
 * Moves an errand with one UPDATE guarded by the state we read (`WHERE state = $from`), as for
 * requests: of two racing moves exactly one updates the row, the other updates nothing. Every
 * applied move is announced to the owner (errand.updated) after it is written.
 */
export async function moveErrand(
  db: Queryable,
  id: string,
  outcome: Outcome,
  events?: EventPublisher,
): Promise<MoveResult> {
  const current = await findErrand(db, id);
  if (!current) return { kind: 'not_found' };
  // SHOPS_REPLIED and USER_ANSWERED are not here: resumeWaiting and resumeAnswered do those moves.
  const result = errandTransition(current.state, outcome.event);
  if (!result.ok) return { kind: 'unchanged' };

  // $1 id, $2 new state, $3 from state, then the event's own values.
  const params: unknown[] = [id, result.to, current.state];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  let set: string;
  switch (outcome.event) {
    case 'PLAN_SUBMITTED':
      set = `plan = ${p(JSON.stringify(outcome.plan))}::jsonb, failure_reason = NULL,
             wait_deadline = NULL, answer_deadline = NULL, question = NULL`;
      break;
    case 'RUN_FAILED':
      set = `plan = COALESCE(${p(outcome.plan === undefined ? null : JSON.stringify(outcome.plan))}::jsonb, plan),
             failure_reason = ${p(outcome.reason)}, wait_deadline = NULL, answer_deadline = NULL`;
      break;
    case 'ASKED_SHOPS':
      set = `wait_started_at = now(), wait_deadline = now() + make_interval(secs => ${p(outcome.waitMs)}::float / 1000)`;
      break;
    case 'ASKED_USER':
      set = `question = ${p(JSON.stringify(outcome.question))}::jsonb, questions_asked = questions_asked + 1,
             answer = NULL, answer_deadline = now() + make_interval(secs => ${p(outcome.answerTimeoutMs)}::float / 1000)`;
      break;
    case 'EXPIRE':
      set = `plan = COALESCE(plan, ${p(outcome.plan === undefined ? null : JSON.stringify(outcome.plan))}::jsonb),
             wait_deadline = NULL, answer_deadline = NULL`;
      break;
    case 'CANCEL':
      set = `wait_deadline = NULL, answer_deadline = NULL`;
      break;
  }
  const moved = await db.query(
    `UPDATE errands
        SET state = $2, version = version + 1, ${set}, lease_until = NULL, updated_at = now()
      WHERE id = $1 AND state = $3
      RETURNING id`,
    params,
  );
  if (moved.rows.length === 0) return { kind: 'unchanged' };
  announceErrand(events, current.userId, id, result.to);
  return { kind: 'applied', to: result.to };
}

/**
 * Every request the errand made has left PINGING (answered, expired or closed), or is past its
 * deadline. A request that has a yes is ANSWERED, so "or has a yes" is part of the same test.
 */
const SETTLED_SQL = `NOT EXISTS (
  SELECT 1 FROM errand_requests er JOIN requests r ON r.id = er.request_id
   WHERE er.errand_id = errands.id AND r.state IN ('OPEN', 'PINGING') AND r.expires_at > now())`;

/**
 * WAITING_FOR_SHOPS → PLANNING, in one guarded UPDATE, only when it is time: every linked request
 * has left PINGING (reason `replies`) or the wait deadline has passed (`timer`). The time spent
 * waiting is added to `waited_ms`. Of any number of racing callers exactly one gets `applied`.
 */
export async function resumeWaiting(
  db: Queryable,
  id: string,
  events?: EventPublisher,
): Promise<'resumed' | 'not_due' | 'not_waiting'> {
  if (!isUuid(id)) return 'not_waiting';
  const { rows } = await db.query<{ user_id: string }>(
    `UPDATE errands
        SET state = 'PLANNING', version = version + 1,
            resume_reason = CASE WHEN ${SETTLED_SQL} THEN 'replies' ELSE 'timer' END,
            waited_ms = waited_ms + COALESCE(round(extract(epoch FROM now() - wait_started_at) * 1000)::int, 0),
            wait_started_at = NULL, wait_deadline = NULL, lease_until = NULL, updated_at = now()
      WHERE id = $1 AND state = 'WAITING_FOR_SHOPS'
        AND (wait_deadline <= now() OR ${SETTLED_SQL})
      RETURNING user_id`,
    [id],
  );
  if (rows[0]) {
    announceErrand(events, rows[0].user_id, id, 'PLANNING');
    return 'resumed';
  }
  const state = await db.query<{ state: ErrandState }>(`SELECT state FROM errands WHERE id = $1`, [
    id,
  ]);
  return state.rows[0]?.state === 'WAITING_FOR_SHOPS' ? 'not_due' : 'not_waiting';
}

/**
 * NEEDS_INPUT → PLANNING with the customer's answer. Guarded on the state, so a second answer (or
 * an answer racing the timeout) finds nothing to update. `answer` null means the time ran out; it
 * only applies when the deadline has passed.
 */
export async function resumeAnswered(
  db: Queryable,
  id: string,
  answer: ErrandAnswer,
  events?: EventPublisher,
): Promise<'resumed' | 'not_due' | 'not_waiting'> {
  if (!isUuid(id)) return 'not_waiting';
  const timedOut = 'timedOut' in answer;
  const { rows } = await db.query<{ user_id: string }>(
    `UPDATE errands
        SET state = 'PLANNING', version = version + 1, answer = $2::jsonb,
            resume_reason = $3, question = NULL, answer_deadline = NULL, lease_until = NULL,
            updated_at = now()
      WHERE id = $1 AND state = 'NEEDS_INPUT' AND ($4 = false OR answer_deadline <= now())
      RETURNING user_id`,
    [id, JSON.stringify(answer), timedOut ? 'answer_timeout' : 'answered', timedOut],
  );
  if (rows[0]) {
    announceErrand(events, rows[0].user_id, id, 'PLANNING');
    return 'resumed';
  }
  const state = await db.query<{ state: ErrandState }>(`SELECT state FROM errands WHERE id = $1`, [
    id,
  ]);
  return state.rows[0]?.state === 'NEEDS_INPUT' ? 'not_due' : 'not_waiting';
}

/** The next run has written its resume note into the log: forget why it started. */
export async function clearResume(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE errands SET resume_reason = NULL, answer = NULL WHERE id = $1`, [id]);
}

export interface RequestLink {
  requestId: string;
  itemId: string;
}

export async function linkRequest(
  db: Queryable,
  errandId: string,
  requestId: string,
  itemId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO errand_requests (errand_id, request_id, item_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [errandId, requestId, itemId],
  );
}

export async function listLinks(db: Queryable, errandId: string): Promise<RequestLink[]> {
  const { rows } = await db.query<{ request_id: string; item_id: string }>(
    `SELECT request_id, item_id FROM errand_requests WHERE errand_id = $1 ORDER BY created_at`,
    [errandId],
  );
  return rows.map((r) => ({ requestId: r.request_id, itemId: r.item_id }));
}

/** Errands waiting on this request: the request.updated hook wakes these. */
export async function waitingOnRequest(db: Queryable, requestId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT e.id FROM errand_requests er JOIN errands e ON e.id = er.errand_id
      WHERE er.request_id = $1 AND e.state = 'WAITING_FOR_SHOPS'`,
    [requestId],
  );
  return rows.map((r) => r.id);
}

export interface Confirmation {
  shopId: string;
  itemId: string;
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  pricePaise: number | null;
  answeredAt: Date;
  /** The shop's photo of the item with its yes. */
  photoId: string | null;
  quantity: ExactQuantity | null;
  delivery: { feePaise: number | null; minutes: number | null } | null;
}

/** Shops that said yes to one of this errand's own requests: the only source of "confirmed". */
export async function listConfirmations(
  db: Queryable,
  errandId: string,
  where: { lat: number; lng: number },
): Promise<Confirmation[]> {
  const { rows } = await db.query<{
    shop_id: string;
    item_id: string;
    name: string;
    lat: number;
    lng: number;
    distance_m: number;
    price_paise: number | null;
    answered_at: Date;
    photo_id: string | null;
    qty_amount: number | null;
    qty_unit: ExactQuantity['unit'] | null;
    delivers: boolean;
    delivery_fee_paise: number | null;
    delivery_minutes: number | null;
  }>(
    `SELECT p.shop_id, p.item_id, s.name, ST_Y(s.location::geometry) AS lat,
            ST_X(s.location::geometry) AS lng,
            ST_Distance(s.location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) AS distance_m,
            p.price_paise, p.answered_at,
            (SELECT ph.id FROM photos ph WHERE ph.ping_id = p.id) AS photo_id,
            p.qty_amount::float8 AS qty_amount, p.qty_unit, p.delivers,
            p.delivery_fee_paise, p.delivery_minutes
       FROM errand_requests er
       JOIN pings p ON p.request_id = er.request_id AND p.item_id = er.item_id
       JOIN shops s ON s.id = p.shop_id
      WHERE er.errand_id = $1 AND p.state = 'YES'
      ORDER BY p.answered_at`,
    [errandId, where.lat, where.lng],
  );
  return rows.map((r) => ({
    shopId: r.shop_id,
    itemId: r.item_id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    distanceM: Math.round(r.distance_m),
    pricePaise: r.price_paise,
    answeredAt: r.answered_at,
    photoId: r.photo_id,
    quantity:
      r.qty_amount !== null && r.qty_unit !== null
        ? { amount: r.qty_amount, unit: r.qty_unit }
        : null,
    delivery: r.delivers ? { feePaise: r.delivery_fee_paise, minutes: r.delivery_minutes } : null,
  }));
}

/** What the progress list shows about the shops: pings sent per request, and each yes. */
export async function progressFacts(db: Queryable, errandId: string) {
  const sent = await db.query<{ request_id: string; n: number }>(
    `SELECT er.request_id, count(p.id)::int AS n
       FROM errand_requests er LEFT JOIN pings p ON p.request_id = er.request_id
      WHERE er.errand_id = $1 GROUP BY er.request_id`,
    [errandId],
  );
  const opened = await db.query<{ request_id: string; created_at: Date }>(
    `SELECT request_id, created_at FROM errand_requests WHERE errand_id = $1`,
    [errandId],
  );
  const yes = await db.query<{
    name: string;
    price_paise: number | null;
    answered_at: Date;
    request_id: string;
  }>(
    `SELECT s.name, p.price_paise, p.answered_at, er.request_id
       FROM errand_requests er
       JOIN pings p ON p.request_id = er.request_id AND p.state = 'YES'
       JOIN shops s ON s.id = p.shop_id
      WHERE er.errand_id = $1 ORDER BY p.answered_at`,
    [errandId],
  );
  return {
    pingsSent: Object.fromEntries(sent.rows.map((r) => [r.request_id, r.n])),
    requestCreated: Object.fromEntries(opened.rows.map((r) => [r.request_id, r.created_at])),
    answers: yes.rows.map((r) => ({
      shopName: r.name,
      pricePaise: r.price_paise,
      at: r.answered_at,
      requestId: r.request_id,
    })),
  };
}

/** What the sweeper looks at (ADR-0024 amendment). All timing is the database's clock. */
export async function findStuckErrandIds(
  db: Queryable,
  limit: number,
): Promise<{
  overdue: string[];
  waiting: string[];
  asking: string[];
  planning: string[];
}> {
  const ids = async (where: string) =>
    (
      await db.query<{ id: string }>(
        `SELECT id FROM errands WHERE ${where} ORDER BY updated_at LIMIT $1`,
        [limit],
      )
    ).rows.map((r) => r.id);
  return {
    overdue: await ids(
      `state IN ('PLANNING', 'WAITING_FOR_SHOPS', 'NEEDS_INPUT') AND expires_at <= now()`,
    ),
    waiting: await ids(`state = 'WAITING_FOR_SHOPS'`),
    asking: await ids(`state = 'NEEDS_INPUT' AND answer_deadline <= now()`),
    // A lease that ran out means a dead worker; no lease and quiet for 90 s means a lost job.
    planning: await ids(
      `state = 'PLANNING' AND (lease_until <= now() OR (lease_until IS NULL AND updated_at < now() - interval '90 seconds'))`,
    ),
  };
}

/** Remembers the customer's choice for one shop: delivery is stored, pickup (the default) removes it. */
export async function setDeliveryMode(
  db: Queryable,
  errandId: string,
  shopId: string,
  mode: 'pickup' | 'delivery',
): Promise<void> {
  await db.query(
    mode === 'delivery'
      ? `UPDATE errands SET delivery_modes = delivery_modes || jsonb_build_object($2::text, 'delivery') WHERE id = $1`
      : `UPDATE errands SET delivery_modes = delivery_modes - $2::text WHERE id = $1`,
    [errandId, shopId],
  );
}
