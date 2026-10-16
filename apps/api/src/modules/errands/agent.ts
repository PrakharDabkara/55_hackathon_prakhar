import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import {
  AiUnavailableError,
  type AiContext,
  type ChatMessage,
  type ToolCall,
} from '../ai/index.js';
import { executeTool, newRunState, type RunState } from './executor.js';
import {
  claimErrand,
  findErrand,
  moveErrand,
  recordStep,
  renewLease,
  type ErrandRecord,
} from './persistence.js';
import { buildPlan, type Plan } from './plan.js';
import { BUDGET_NUDGE, buildSystemPrompt, buildTaskMessage, SUBMIT_NUDGE } from './prompt.js';
import type { ErrandLimits } from './service.js';
import { AGENT_TOOLS } from './tools.js';

export interface RunDeps {
  db: Database;
  logger: Logger;
  ai: AiContext;
  limits: ErrandLimits;
  trigramThreshold: number;
  /** Least time between two model calls; keeps a free-tier key under its requests-per-minute cap. */
  paceMs?: number;
  /** Extra attempts after a 429 or 5xx from the model (default 1). The free tier has busy spells. */
  modelRetries?: number;
  /** For tests: replace the pause between model calls. */
  sleep?: (ms: number) => Promise<void>;
}

export type RunResult = {
  outcome: 'plan_ready' | 'failed' | 'busy' | 'skipped' | 'not_found';
};

/** Most the model may write in one turn: a plan of 10 items fits well inside. */
const MAX_OUTPUT_TOKENS = 1500;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** When the last model call of any errand started; with concurrency 1 this is the pacing clock. */
let lastModelCallAt = 0;

/**
 * Runs the errand agent (ADR-0024): ask the model, run the tools it picked, give it the results,
 * repeat until it calls submit_plan. Everything it does is written to errand_steps. At most one run
 * works on an errand at a time (a lease in the database); a second call returns "busy".
 *
 * When a limit is reached the model is told to submit now and may call only submit_plan; if it
 * still does not, the errand FAILs with a reason and what was found so far.
 */
export async function runErrand(deps: RunDeps, errandId: string): Promise<RunResult> {
  const claim = await claimErrand(deps.db, errandId);
  if (claim !== 'claimed') return { outcome: claim };

  const errand = (await findErrand(deps.db, errandId)) as ErrandRecord;
  const log = deps.logger.child({
    errandId,
    ...(errand.requestId && { requestId: errand.requestId }),
  });
  const state = newRunState();
  try {
    return await loop(deps, errand, state, log);
  } catch (error) {
    log.error({ err: error }, 'errand run crashed');
    await fail(deps, errandId, 'internal_error', state, log);
    return { outcome: 'failed' };
  }
}

async function fail(
  deps: RunDeps,
  errandId: string,
  reason: string,
  state: RunState,
  log: Logger,
): Promise<void> {
  const partial = { partial: true, found: [...state.found.values()] };
  const moved = await moveErrand(deps.db, errandId, { event: 'RUN_FAILED', reason, plan: partial });
  log.warn({ reason, applied: moved.kind === 'applied' }, 'errand failed');
}

async function loop(
  deps: RunDeps,
  errand: ErrandRecord,
  state: RunState,
  log: Logger,
): Promise<RunResult> {
  const { db, ai, limits } = deps;
  const messages: ChatMessage[] = [
    {
      role: 'user',
      text: buildTaskMessage({ task: errand.task, budgetPaise: errand.budgetPaise }),
    },
  ];
  const system = buildSystemPrompt({ maxItems: limits.maxItems });
  let modelSteps = 0;
  let tokens = 0;
  let forced: 'step_limit' | 'token_budget' | null = null;

  for (;;) {
    if (!forced && (modelSteps >= limits.maxSteps - 1 || tokens >= limits.tokenBudget)) {
      forced = tokens >= limits.tokenBudget ? 'token_budget' : 'step_limit';
      messages.push({ role: 'user', text: BUDGET_NUDGE });
      log.info({ cap: forced, modelSteps, tokens }, 'errand cap reached, asking for the plan');
    }
    const wasForced = forced;

    // Still ours? A crashed worker's lease runs out and the job may restart; never run twice.
    if (!(await renewLease(db, errand.id))) {
      log.warn('errand lease lost, stopping this run');
      return { outcome: 'busy' };
    }

    if (deps.paceMs) {
      const wait = lastModelCallAt + deps.paceMs - Date.now();
      if (wait > 0) await (deps.sleep ?? pause)(wait);
    }
    lastModelCallAt = Date.now();

    let turn;
    try {
      turn = await ai.client.chatWithTools({
        system,
        messages,
        tools: AGENT_TOOLS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        purpose: 'errand',
        ...(deps.modelRetries !== undefined && { retries: deps.modelRetries }),
        ...(wasForced && { forceTool: 'submit_plan' }),
        ...(errand.requestId && { requestId: errand.requestId }),
      });
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      log.warn({ kind: error.kind }, 'errand model call unavailable');
      await fail(deps, errand.id, 'ai_unavailable', state, log);
      return { outcome: 'failed' };
    }

    modelSteps++;
    tokens += turn.usage.inputTokens + turn.usage.outputTokens;
    await recordStep(db, errand.id, {
      kind: 'model',
      args: {
        calls: turn.toolCalls.map((c) => ({ name: c.name, args: c.args })),
        ...(turn.text && { text: turn.text }),
      },
      tokensIn: turn.usage.inputTokens,
      tokensOut: turn.usage.outputTokens,
      latencyMs: turn.latencyMs,
    });
    log.info(
      { step: modelSteps, tools: turn.toolCalls.map((c) => c.name), tokens },
      'errand model step',
    );
    messages.push({
      role: 'model',
      ...(turn.text && { text: turn.text }),
      ...(turn.toolCalls.length > 0 && { toolCalls: turn.toolCalls }),
    });

    if (turn.toolCalls.length === 0) {
      if (wasForced) {
        await fail(deps, errand.id, wasForced, state, log);
        return { outcome: 'failed' };
      }
      messages.push({ role: 'user', text: SUBMIT_NUDGE });
      continue;
    }

    const results: { id: string; name: string; result: unknown }[] = [];
    let submitted: Plan | undefined;
    for (const call of turn.toolCalls) {
      const done = await runTool(deps, errand, state, call, log);
      results.push({ id: call.id, name: call.name, result: done.result });
      if (done.plan) {
        submitted = done.plan;
        break;
      }
    }

    if (submitted) {
      const moved = await moveErrand(db, errand.id, { event: 'PLAN_SUBMITTED', plan: submitted });
      log.info({ modelSteps, tokens, applied: moved.kind === 'applied' }, 'errand plan ready');
      return { outcome: 'plan_ready' };
    }

    messages.push({ role: 'tool', results });
    if (wasForced) {
      await fail(deps, errand.id, wasForced, state, log);
      return { outcome: 'failed' };
    }
  }
}

async function runTool(
  deps: RunDeps,
  errand: ErrandRecord,
  state: RunState,
  call: ToolCall,
  log: Logger,
) {
  const started = Date.now();
  let outcome;
  try {
    outcome = await executeTool(
      {
        db: deps.db,
        logger: log,
        ai: deps.ai,
        userId: errand.userId,
        where: { lat: errand.lat, lng: errand.lng },
        requestId: errand.requestId,
        trigramThreshold: deps.trigramThreshold,
        maxItems: deps.limits.maxItems,
        state,
      },
      call,
    );
  } catch (error) {
    // A broken tool must not end the errand: tell the model, which can work around it.
    log.warn({ tool: call.name, err: error }, 'errand tool failed');
    outcome = {
      result: { error: 'the tool failed; try another way or submit what you have' },
      summary: { error: true },
    };
  }
  // submit_plan was well-formed: check it against the database now, so the step records the outcome.
  let plan: Plan | undefined;
  if (outcome.submitted) {
    try {
      plan = await buildPlan(deps.db, errand, outcome.submitted);
      const likely = plan.items.filter((i) => i.status === 'likely').length;
      outcome = { ...outcome, summary: { likely, notFound: plan.items.length - likely } };
    } catch (error) {
      log.warn({ tool: call.name, err: error }, 'errand plan check failed');
      outcome = {
        result: { error: 'the plan could not be checked; submit it again' },
        summary: { error: true },
      };
    }
  }
  await recordStep(deps.db, errand.id, {
    kind: 'tool',
    toolName: call.name,
    args: call.args,
    resultSummary: outcome.summary,
    latencyMs: Date.now() - started,
  });
  return { result: outcome.result, plan };
}
