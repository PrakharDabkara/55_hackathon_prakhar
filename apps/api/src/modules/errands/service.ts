import type { Logger } from 'pino';
import type { Config } from '../../config/config.js';
import type { Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { looksLikeInstruction } from '../ai/index.js';
import {
  findErrand,
  insertErrand,
  listSteps,
  moveErrand,
  type ErrandRecord,
} from './persistence.js';
import { buildProgress } from './progress.js';
import type { ErrandState } from './stateMachine.js';

/** The guardrails (ADR-0024). The model never decides them. */
export interface ErrandLimits {
  maxItems: number;
  /** Model calls, counting the one that is forced to submit. */
  maxSteps: number;
  /** Input plus output tokens spent by the errand's model calls. */
  tokenBudget: number;
  userHourlyLimit: number;
  taskMaxChars: number;
}

export const limitsFromConfig = (config: Config): ErrandLimits => ({
  maxItems: config.errandMaxItems,
  maxSteps: config.errandMaxSteps,
  tokenBudget: config.errandTokenBudget,
  userHourlyLimit: config.errandUserHourlyLimit,
  taskMaxChars: config.errandTaskMaxChars,
});

export interface ErrandsContext {
  db: Database;
  logger: Logger;
  limits: ErrandLimits;
  /** Queues the agent job. Without it (no Redis) the errand is stored and waits. */
  enqueue?: ((errandId: string) => Promise<void>) | undefined;
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
      await moveErrand(ctx.db, id, { event: 'RUN_FAILED', reason: 'queue_unavailable' });
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
  plan: unknown;
  failureReason: string | null;
  usage: { steps: number; tokensIn: number; tokensOut: number };
  createdAt: Date;
  updatedAt: Date;
}

export const viewOf = (e: ErrandRecord, progress: string[]): ErrandView => ({
  id: e.id,
  state: e.state,
  task: e.task,
  budgetPaise: e.budgetPaise,
  progress,
  plan: e.plan,
  failureReason: e.failureReason,
  usage: { steps: e.stepCount, tokensIn: e.tokensIn, tokensOut: e.tokensOut },
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

/** The owner's view of an errand, or null for an unknown id or someone else's errand. */
export async function getErrand(
  ctx: Pick<ErrandsContext, 'db'>,
  userId: string,
  id: string,
): Promise<ErrandView | null> {
  const errand = await findErrand(ctx.db, id);
  if (!errand || errand.userId !== userId) return null;
  const steps = await listSteps(ctx.db, id);
  return viewOf(errand, buildProgress(steps, errand.state, errand.failureReason));
}
