import type { Logger } from 'pino';
import type { Config } from '../../config/config.js';
import type { Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { looksLikeInstruction } from '../ai/index.js';
import type { EventPublisher } from '../realtime/index.js';
import type { RequestsContext } from '../requests/index.js';
import { closeLinkedRequests } from './bridge.js';
import { partialPlan, rebuildRunState } from './conversation.js';
import {
  findErrand,
  findStuckErrandIds,
  insertErrand,
  listSteps,
  moveErrand,
  progressFacts,
  resumeAnswered,
  resumeWaiting,
  type ErrandQuestion,
  type ErrandRecord,
} from './persistence.js';
import { buildProgress, lateAnswerLines } from './progress.js';
import { isFinal, type ErrandState } from './stateMachine.js';
import { sanitiseTask } from './prompt.js';

/** The guardrails (ADR-0024). The model never decides them. */
export interface ErrandLimits {
  maxItems: number;
  /** Model calls, counting the one that is forced to submit. */
  maxSteps: number;
  /** Input plus output tokens spent by the errand's model calls. */
  tokenBudget: number;
  userHourlyLimit: number;
  taskMaxChars: number;
  /** Requests one errand may open with ask_shops. */
  maxAskShops: number;
  /** Questions one errand may put to the customer. */
  maxQuestions: number;
  /** A waiting errand resumes after this long even if shops are slow. */
  resumeAfterMs: number;
  /** Total waiting for shops; after it the agent must submit. */
  maxWaitMs: number;
  /** An unanswered question gives up after this long. */
  answerTimeoutMs: number;
  /** Overall life of an errand. */
  expiryMs: number;
  /** A burst of answers within this window causes one resume check. */
  resumeDebounceMs: number;
  /** kam_dukaan is recommended if it costs at most this many paise more than sasta (or 10 %). */
  fewerStopsMaxExtraPaise: number;
}

export const limitsFromConfig = (config: Config): ErrandLimits => ({
  maxItems: config.errandMaxItems,
  maxSteps: config.errandMaxSteps,
  tokenBudget: config.errandTokenBudget,
  userHourlyLimit: config.errandUserHourlyLimit,
  taskMaxChars: config.errandTaskMaxChars,
  maxAskShops: config.errandMaxAskShops,
  maxQuestions: config.errandMaxQuestions,
  resumeAfterMs: config.errandResumeAfterMs,
  maxWaitMs: config.errandMaxWaitMs,
  answerTimeoutMs: config.errandAnswerTimeoutMs,
  expiryMs: config.errandExpiryMs,
  resumeDebounceMs: config.errandResumeDebounceMs,
  fewerStopsMaxExtraPaise: config.errandFewerStopsMaxExtraPaise,
});

/**
 * Queues a run of the agent. `delayMs` makes it a timer; `key` is added to the job id so a second
 * wake-up of the same errand is a new job (the database lease still lets only one run work).
 */
export type EnqueueErrand = (
  errandId: string,
  options?: { delayMs?: number; key?: string },
) => Promise<void>;

export interface ErrandsContext {
  db: Database;
  logger: Logger;
  limits: ErrandLimits;
  /** Queues the agent job. Without it (no Redis) the errand is stored and waits. */
  enqueue?: EnqueueErrand | undefined;
  /** Realtime hints (errand.updated) to the owner. */
  events?: EventPublisher | undefined;
  /** How requests are opened and closed for the errand; defaults are fine without fan-out. */
  requests?: RequestsContext | undefined;
}

export interface CreateErrandInput {
  task: string;
  lat: number;
  lng: number;
  budgetPaise?: number | undefined;
  requestId?: string | undefined;
}

/**
 * Stores a new errand and queues the agent. A task that reads like an instruction to a model is
 * refused (422 task_rejected) before anything is stored or sent anywhere; over the hourly limit
 * is 429. If the queue is down the errand FAILs at once rather than waiting for a job that never
 * comes.
 */
export async function createErrand(
  ctx: ErrandsContext,
  userId: string,
  input: CreateErrandInput,
): Promise<{ id: string; state: ErrandState }> {
  const task = input.task.trim();
  if (task.length === 0 || task.length > ctx.limits.taskMaxChars) {
    throw new ApiError(400, 'invalid_request', `task: 1 to ${ctx.limits.taskMaxChars} characters`);
  }
  if (looksLikeInstruction(task)) {
    // Not stored, not logged, never sent to a model: say what an errand task is instead.
    ctx.logger.warn({ event: 'errand_task_rejected' }, 'errand task looked like an instruction');
    throw new ApiError(
      422,
      'task_rejected',
      'Please describe only what you want to buy, for example "chart paper, fevicol aur sketch pens".',
    );
  }

  const created = await insertErrand(ctx.db, {
    userId,
    task,
    lat: input.lat,
    lng: input.lng,
    budgetPaise: input.budgetPaise ?? null,
    requestId: input.requestId ?? null,
    hourlyLimit: ctx.limits.userHourlyLimit,
    expiryMs: ctx.limits.expiryMs,
  });
  if (created.kind === 'rate_limited') {
    throw new ApiError(
      429,
      'errand_rate_limited',
      `At most ${ctx.limits.userHourlyLimit} errands an hour. Try again later.`,
    );
  }

  const { id } = created;
  ctx.logger.info({ errandId: id }, 'errand created');
  if (ctx.enqueue) {
    try {
      await ctx.enqueue(id);
    } catch (error) {
      ctx.logger.error(
        { errandId: id, reason: (error as Error).message },
        'could not queue errand',
      );
      await moveErrand(
        ctx.db,
        id,
        { event: 'RUN_FAILED', reason: 'queue_unavailable' },
        ctx.events,
      );
      return { id, state: 'FAILED' };
    }
  }
  return { id, state: 'PLANNING' };
}

export interface ErrandView {
  id: string;
  state: ErrandState;
  task: string;
  budgetPaise: number | null;
  /** Short Hinglish lines built from the step log. */
  progress: string[];
  /** Shops that said yes after the plan was ready: kept out of `progress`. */
  lateAnswers: string[];
  plan: unknown;
  failureReason: string | null;
  usage: { steps: number; tokensIn: number; tokensOut: number };
  /** The open question while NEEDS_INPUT; answer it with POST /errands/:id/answer. */
  question: ErrandQuestion | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const viewOf = (
  e: ErrandRecord,
  progress: string[],
  lateAnswers: string[] = [],
): ErrandView => ({
  id: e.id,
  state: e.state,
  task: e.task,
  budgetPaise: e.budgetPaise,
  progress,
  lateAnswers,
  plan: e.plan,
  failureReason: e.failureReason,
  usage: { steps: e.stepCount, tokensIn: e.tokensIn, tokensOut: e.tokensOut },
  question: e.state === 'NEEDS_INPUT' ? e.question : null,
  expiresAt: e.expiresAt,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

/** The owner's view of an errand, or null for an unknown id or someone else's errand. */
export async function getErrand(
  ctx: Pick<ErrandsContext, 'db' | 'logger' | 'events' | 'requests'>,
  userId: string,
  id: string,
): Promise<ErrandView | null> {
  let errand = await findErrand(ctx.db, id);
  if (!errand || errand.userId !== userId) return null;
  // Lazy expiry: an overdue errand ends the moment its owner looks, whatever the sweeper did.
  if (!isFinal(errand.state) && errand.expiresAt.getTime() <= Date.now()) {
    await expireErrand(ctx, id);
    errand = (await findErrand(ctx.db, id)) ?? errand;
  }
  return viewWithProgress(ctx, errand);
}

async function viewWithProgress(
  ctx: Pick<ErrandsContext, 'db'>,
  errand: ErrandRecord,
): Promise<ErrandView> {
  const [steps, facts] = await Promise.all([
    listSteps(ctx.db, errand.id),
    progressFacts(ctx.db, errand.id),
  ]);
  return viewOf(
    errand,
    buildProgress(steps, errand.state, errand.failureReason, facts),
    lateAnswerLines(steps, facts),
  );
}

type Quiet = Pick<ErrandsContext, 'db' | 'logger' | 'events' | 'requests'>;

/** Ends an errand that ran out of time, keeping what the agent had found. */
export async function expireErrand(ctx: Quiet, id: string): Promise<boolean> {
  const errand = await findErrand(ctx.db, id);
  if (!errand || isFinal(errand.state)) return false;
  const state = rebuildRunState(await listSteps(ctx.db, id), errand.questionsAsked);
  const moved = await moveErrand(
    ctx.db,
    id,
    { event: 'EXPIRE', plan: partialPlan(state) },
    ctx.events,
  );
  if (moved.kind !== 'applied') return false;
  ctx.logger.info({ errandId: id }, 'errand expired');
  await closeLinkedRequests(ctx, errand.userId, id);
  return true;
}

export type CancelOutcome = ErrandView | null;

/**
 * The owner stops an errand: CANCELLED, and every request it opened that is still open is closed,
 * so no more shops are pinged. A finished errand is returned as it is.
 */
export async function cancelErrand(ctx: Quiet, userId: string, id: string): Promise<CancelOutcome> {
  const errand = await findErrand(ctx.db, id);
  if (!errand || errand.userId !== userId) return null;
  const moved = await moveErrand(ctx.db, id, { event: 'CANCEL' }, ctx.events);
  if (moved.kind === 'applied') {
    ctx.logger.info({ errandId: id }, 'errand cancelled');
    await closeLinkedRequests(ctx, userId, id);
  }
  return viewWithProgress(ctx, (await findErrand(ctx.db, id)) ?? errand);
}

export type AnswerInput = { text?: string | undefined; optionIndex?: number | undefined };

const MAX_ANSWER_CHARS = 200;

/**
 * The owner answers the agent's question (typed, or one of the options) and the errand resumes.
 * The answer is data, like the task: an answer that reads like an instruction to a model is refused.
 */
export async function answerErrand(
  ctx: ErrandsContext,
  userId: string,
  id: string,
  input: AnswerInput,
): Promise<ErrandView> {
  const errand = await findErrand(ctx.db, id);
  if (!errand || errand.userId !== userId) throw new ApiError(404, 'not_found', 'No such errand');
  if (errand.state !== 'NEEDS_INPUT') {
    throw new ApiError(
      409,
      'errand_not_waiting_for_answer',
      'This errand is not asking a question',
    );
  }
  const hasText = input.text !== undefined;
  const hasOption = input.optionIndex !== undefined;
  if (hasText === hasOption)
    throw new ApiError(400, 'invalid_request', 'Send exactly one of text or optionIndex');

  let text: string;
  if (hasOption) {
    const options = errand.question?.options ?? [];
    const picked = options[input.optionIndex as number];
    if (!Number.isInteger(input.optionIndex) || picked === undefined)
      throw new ApiError(400, 'invalid_request', 'optionIndex does not match any option');
    text = picked;
  } else {
    text = sanitiseTask(String(input.text));
    if (text.length === 0 || text.length > MAX_ANSWER_CHARS)
      throw new ApiError(400, 'invalid_request', `text: 1 to ${MAX_ANSWER_CHARS} characters`);
    if (looksLikeInstruction(text)) {
      ctx.logger.warn(
        { event: 'errand_answer_rejected' },
        'errand answer looked like an instruction',
      );
      throw new ApiError(
        422,
        'task_rejected',
        'Please answer only the question, for example "floor cleaner".',
      );
    }
  }

  const resumed = await resumeAnswered(ctx.db, id, { text }, ctx.events);
  if (resumed !== 'resumed')
    throw new ApiError(
      409,
      'errand_not_waiting_for_answer',
      'This errand is not asking a question',
    );
  ctx.logger.info({ errandId: id }, 'errand answered');
  await wake(ctx, id, 'a');
  return viewWithProgress(ctx, (await findErrand(ctx.db, id)) as ErrandRecord);
}

/** Queue a run for an errand that is PLANNING again. A failure here is repaired by the sweeper. */
export async function wake(
  ctx: Pick<ErrandsContext, 'db' | 'logger' | 'enqueue'>,
  id: string,
  tag: string,
): Promise<void> {
  if (!ctx.enqueue) return;
  try {
    const errand = await findErrand(ctx.db, id);
    await ctx.enqueue(id, { key: `${tag}${errand?.version ?? 0}` });
  } catch (error) {
    ctx.logger.warn(
      { errandId: id, reason: (error as Error).message },
      'could not queue errand run',
    );
  }
}

/**
 * Wakes a waiting errand if it is time: every request it made has left PINGING, or its wait
 * deadline passed. One guarded UPDATE, so of any number of racing callers exactly one gets
 * "resumed" and the others see the errand already moved.
 */
export async function resumeIfDue(
  ctx: Pick<ErrandsContext, 'db' | 'events'>,
  id: string,
): Promise<'resumed' | 'not_due' | 'not_waiting'> {
  return resumeWaiting(ctx.db, id, ctx.events);
}

/** An unanswered question gives up once its deadline has passed. */
export async function answerTimeoutIfDue(
  ctx: Pick<ErrandsContext, 'db' | 'events'>,
  id: string,
): Promise<'resumed' | 'not_due' | 'not_waiting'> {
  return resumeAnswered(ctx.db, id, { timedOut: true }, ctx.events);
}

const SWEEP_BATCH = 100;

/**
 * The errand part of the 60 s sweeper (ADR-0024 amendment). Postgres holds every deadline, so a
 * job lost with a Redis restart, or a sleeping free instance, costs a minute at most:
 *  - past its overall limit: EXPIRED;
 *  - WAITING_FOR_SHOPS and due (deadline passed, or every request has left PINGING): resume;
 *  - NEEDS_INPUT past its answer deadline: resume with "did not answer";
 *  - PLANNING with a lease that ran out (a dead worker), or no lease and quiet for 90 s: run again.
 * Returns how many errands it touched.
 */
export async function sweepErrands(
  ctx: Pick<ErrandsContext, 'db' | 'logger' | 'enqueue' | 'events' | 'requests'>,
): Promise<number> {
  const stuck = await findStuckErrandIds(ctx.db, SWEEP_BATCH);
  let touched = 0;
  for (const id of stuck.overdue) if (await expireErrand(ctx, id)) touched++;
  for (const id of stuck.waiting) {
    if ((await resumeIfDue(ctx, id)) === 'resumed') {
      await wake(ctx, id, 's');
      touched++;
    }
  }
  for (const id of stuck.asking) {
    if ((await answerTimeoutIfDue(ctx, id)) === 'resumed') {
      await wake(ctx, id, 's');
      touched++;
    }
  }
  for (const id of stuck.planning) {
    if (stuck.overdue.includes(id)) continue;
    await wake(ctx, id, `s${Date.now()}-`);
    touched++;
  }
  if (touched > 0) ctx.logger.info({ touched }, 'errand sweeper moved errands along');
  return touched;
}
