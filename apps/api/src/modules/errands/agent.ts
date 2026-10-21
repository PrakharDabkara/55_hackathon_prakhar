import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import {
  AiUnavailableError,
  type AiContext,
  type ChatMessage,
  type ToolCall,
} from '../ai/index.js';
import type { EventPublisher } from '../realtime/index.js';
import type { RequestsContext } from '../requests/index.js';
import { closeLinkedRequests, linkedStatuses, requestsContextOf } from './bridge.js';
import {
  INTERRUPTED,
  modelPayload,
  partialPlan,
  rebuildMessages,
  rebuildRunState,
} from './conversation.js';
import { checklistFor, executeTool, refusalKey, type RunState } from './executor.js';
import { namedFragments } from './named.js';
import {
  claimErrand,
  clearResume,
  findErrand,
  listConfirmations,
  listLinks,
  listSteps,
  moveErrand,
  recordStep,
  renewLease,
  type ErrandQuestion,
  type ErrandRecord,
} from './persistence.js';
import { buildPlan, type Plan } from './plan.js';
import {
  buildAnswerNote,
  BUDGET_NUDGE,
  buildStatusNote,
  buildSystemPrompt,
  buildTaskMessage,
  NO_ANSWER_NOTE,
  SUBMIT_NUDGE,
  WAIT_NUDGE,
} from './prompt.js';
import {
  answerTimeoutIfDue,
  expireErrand,
  resumeIfDue,
  wake,
  type EnqueueErrand,
  type ErrandLimits,
} from './service.js';
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
  /** Queues a later run: the wait timer, the answer timeout, an immediate resume. */
  enqueue?: EnqueueErrand | undefined;
  /** errand.updated hints to the owner. */
  events?: EventPublisher | undefined;
  /** How requests are opened (with the fan-out hooks); the plain defaults otherwise. */
  requests?: RequestsContext | undefined;
}

export type RunResult = {
  outcome:
    | 'plan_ready'
    | 'failed'
    | 'busy'
    | 'skipped'
    | 'not_found'
    | 'waiting'
    | 'needs_input'
    | 'expired';
};

/** Most the model may write in one turn: a plan of 10 items fits well inside. */
const MAX_OUTPUT_TOKENS = 1500;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** When the last model call of any errand started; with concurrency 1 this is the pacing clock. */
let lastModelCallAt = 0;

type Forced = 'step_limit' | 'token_budget' | 'wait_limit';

/**
 * Runs the errand agent (ADR-0024): ask the model, run the tools it picked, give it the results,
 * repeat until it calls submit_plan. Every message is written to errand_steps, so a run can stop
 * and a later run rebuild the conversation exactly:
 *  - it asked shops and has nothing else to do → WAITING_FOR_SHOPS, resumed by replies or a timer;
 *  - it asked the customer → NEEDS_INPUT, resumed by their answer or a timeout;
 *  - it submitted → PLAN_READY.
 * At most one run works on an errand at a time (a lease in the database); a second call returns
 * "busy". A job for a waiting errand whose time has not come does nothing ("skipped").
 *
 * When a limit is reached the model is told to submit now and may call only submit_plan; if it
 * still does not, the errand FAILs with a reason and what was found so far.
 */
export async function runErrand(deps: RunDeps, errandId: string): Promise<RunResult> {
  const first = await findErrand(deps.db, errandId);
  if (!first) return { outcome: 'not_found' };

  // A job is only a nudge: a waiting errand runs when its time has come, otherwise nothing happens.
  const ctx = { ...deps, requests: deps.requests };
  if (first.state === 'WAITING_FOR_SHOPS' || first.state === 'NEEDS_INPUT') {
    if (first.expiresAt.getTime() <= Date.now()) {
      await expireErrand(ctx, errandId);
      return { outcome: 'expired' };
    }
    const woke =
      first.state === 'WAITING_FOR_SHOPS'
        ? await resumeIfDue(ctx, errandId)
        : await answerTimeoutIfDue(ctx, errandId);
    if (woke !== 'resumed') return { outcome: 'skipped' };
  }

  const claim = await claimErrand(deps.db, errandId);
  if (claim !== 'claimed') return { outcome: claim };

  const errand = (await findErrand(deps.db, errandId)) as ErrandRecord;
  const log = deps.logger.child({
    errandId,
    ...(errand.requestId && { requestId: errand.requestId }),
  });
  let state: RunState = rebuildRunState([], errand.questionsAsked);
  try {
    const steps = await listSteps(deps.db, errandId);
    state = rebuildRunState(steps, errand.questionsAsked);
    return await loop(deps, errand, steps, state, log);
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
  const moved = await moveErrand(
    deps.db,
    errandId,
    { event: 'RUN_FAILED', reason, plan: partialPlan(state) },
    deps.events,
  );
  log.warn({ reason, applied: moved.kind === 'applied' }, 'errand failed');
}

/** The tool message for calls that did not run, so every function call still has its response. */
const notRun = (reason: string) => ({ error: `not run: ${reason}` });

async function loop(
  deps: RunDeps,
  errand: ErrandRecord,
  history: Awaited<ReturnType<typeof listSteps>>,
  state: RunState,
  log: Logger,
): Promise<RunResult> {
  const { db, ai, limits } = deps;
  const requests = requestsContextOf(deps);
  const system = buildSystemPrompt({ maxItems: limits.maxItems });
  const rebuilt = rebuildMessages(
    {
      role: 'user',
      text: buildTaskMessage({ task: errand.task, budgetPaise: errand.budgetPaise }),
    },
    history,
  );
  const messages: ChatMessage[] = rebuilt.messages;
  let modelSteps = history.filter((s) => s.kind === 'model').length;
  let tokens = errand.tokensIn + errand.tokensOut;
  let forced: Forced | null = null;

  /** A user-role message the server adds. It is logged too, so a later run sees the same thing. */
  const note = async (text: string, ticked?: string[], declined?: string[]) => {
    messages.push({ role: 'user', text });
    state.epoch++;
    await recordStep(db, errand.id, {
      kind: 'note',
      payload: {
        text,
        ...(ticked && ticked.length > 0 && { ticked }),
        ...(declined && declined.length > 0 && { declined }),
      },
    });
  };
  /** Results go into one tool message per model turn, in call order. */
  const toolResults = (results: { id: string; name: string; result: unknown }[]) => {
    const last = messages.at(-1);
    if (last?.role === 'tool') last.results.push(...results);
    else messages.push({ role: 'tool', results: [...results] });
  };

  // 1. A run that died between a model turn and its tools: answer the calls that never ran.
  for (const call of rebuilt.dangling) {
    const result = { error: INTERRUPTED };
    await recordStep(db, errand.id, {
      kind: 'tool',
      toolName: call.name,
      args: call.args,
      resultSummary: { error: true, interrupted: true },
      payload: { id: call.id, name: call.name, result },
    });
    toolResults([{ id: call.id, name: call.name, result }]);
  }

  // 2. Why this run started: shops answered or time passed, the customer answered, or gave up.
  if (errand.resumeReason) {
    const links = await listLinks(db, errand.id);
    const statuses = await linkedStatuses(requests, errand.userId, links);
    const waitOver = errand.waitedMs >= limits.maxWaitMs;
    let text: string;
    let ticked: string[] | undefined;
    let declined: string[] | undefined;
    if (errand.resumeReason === 'answered') {
      const answer = errand.answer && 'text' in errand.answer ? errand.answer.text : '';
      ticked = errand.answer && 'text' in errand.answer ? errand.answer.ticked : undefined;
      for (const word of ticked ?? []) state.ticked.add(refusalKey(word));
      declined = errand.answer && 'text' in errand.answer ? errand.answer.declined : undefined;
      for (const word of declined ?? []) state.declined.add(refusalKey(word));
      text = buildStatusNote(buildAnswerNote(answer), statuses);
    } else if (errand.resumeReason === 'answer_timeout') {
      text = buildStatusNote(NO_ANSWER_NOTE, statuses);
    } else {
      const seconds = Math.round(errand.waitedMs / 1000);
      text = buildStatusNote(
        `You have waited ${seconds} s for shops in total. Shops that have not answered are shown as pending.`,
        statuses,
      );
    }
    if (waitOver) {
      forced = 'wait_limit';
      text += `\n${WAIT_NUDGE}`;
    }
    await note(text, ticked, declined);
    await clearResume(db, errand.id);
    log.info({ reason: errand.resumeReason, waitedMs: errand.waitedMs }, 'errand resumed');
  }

  for (;;) {
    if (!forced && (modelSteps >= limits.maxSteps - 1 || tokens >= limits.tokenBudget)) {
      forced = tokens >= limits.tokenBudget ? 'token_budget' : 'step_limit';
      await note(BUDGET_NUDGE);
      log.info({ cap: forced, modelSteps, tokens }, 'errand cap reached, asking for the plan');
    }
    const wasForced = forced;

    // Still ours? A crashed worker's lease runs out and the job may restart; never run twice.
    // A cancel, an expiry or a take-over ends this run here.
    const lease = await renewLease(db, errand.id);
    if (lease === 'expired') {
      await expireErrand({ ...deps, requests: deps.requests }, errand.id);
      return { outcome: 'expired' };
    }
    if (lease === 'lost') {
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
    const modelMessage = {
      ...(turn.text && { text: turn.text }),
      ...(turn.toolCalls.length > 0 && { toolCalls: turn.toolCalls }),
    };
    await recordStep(db, errand.id, {
      kind: 'model',
      args: {
        calls: turn.toolCalls.map((c) => ({ name: c.name, args: c.args })),
        ...(turn.text && { text: turn.text }),
      },
      // The full message, thought signatures included: this is what a resumed run sends back.
      payload: modelPayload(modelMessage),
      tokensIn: turn.usage.inputTokens,
      tokensOut: turn.usage.outputTokens,
      latencyMs: turn.latencyMs,
    });
    log.info(
      { step: modelSteps, tools: turn.toolCalls.map((c) => c.name), tokens },
      'errand model step',
    );
    messages.push({ role: 'model', ...modelMessage });

    if (turn.toolCalls.length === 0) {
      if (wasForced) {
        await fail(deps, errand.id, wasForced, state, log);
        return { outcome: 'failed' };
      }
      // It said something instead of calling a tool. If it has asked shops, that is its way of
      // saying it is waiting for them; otherwise it must still hand in a plan.
      if ((await listLinks(db, errand.id)).length > 0) return goWaiting(deps, errand, log);
      await note(SUBMIT_NUDGE);
      continue;
    }

    const results: { id: string; name: string; result: unknown }[] = [];
    let submitted: Plan | undefined;
    let question: ErrandQuestion | undefined;
    let askedShops = 0;
    const needConfirm: string[] = [];
    for (const call of turn.toolCalls) {
      if (question) {
        // The customer must answer first; this call is not run but still gets its response.
        const result = notRun('the customer must answer your question first');
        results.push({ id: call.id, name: call.name, result });
        await recordToolStep(deps, errand.id, call, { error: true, notRun: true }, result, 0);
        continue;
      }
      const done = await runTool(deps, requests, errand, state, call, log);
      results.push({ id: call.id, name: call.name, result: done.result });
      if (done.plan) {
        submitted = done.plan;
        break;
      }
      if (done.question) question = done.question;
      if (done.asked) askedShops++;
      for (const label of done.confirm ?? []) needConfirm.push(label);
    }

    // ADR-0049: the agent tried to ask shops about items the customer has not confirmed. If it did
    // not ask them itself, the server asks the checklist now, before any shop is asked about them.
    if (
      !question &&
      !submitted &&
      needConfirm.length > 0 &&
      state.questionsAsked < limits.maxQuestions
    ) {
      state.questionsAsked++;
      question = checklistFor(errand.task, needConfirm);
    }

    if (submitted) {
      const moved = await moveErrand(
        db,
        errand.id,
        { event: 'PLAN_SUBMITTED', plan: submitted },
        deps.events,
      );
      log.info({ modelSteps, tokens, applied: moved.kind === 'applied' }, 'errand plan ready');
      if (moved.kind === 'applied')
        await closeLinkedRequests({ ...deps, requests }, errand.userId, errand.id);
      return { outcome: moved.kind === 'applied' ? 'plan_ready' : 'busy' };
    }

    toolResults(results);

    if (question) {
      const moved = await moveErrand(
        db,
        errand.id,
        { event: 'ASKED_USER', question, answerTimeoutMs: limits.answerTimeoutMs },
        deps.events,
      );
      if (moved.kind !== 'applied') return { outcome: 'busy' };
      log.info({ question: question.question }, 'errand asked the customer');
      // The answer wakes it; this timer wakes it if the customer never answers.
      const latest = (await findErrand(db, errand.id)) as ErrandRecord;
      await deps
        .enqueue?.(errand.id, { delayMs: limits.answerTimeoutMs, key: `q${latest.version}` })
        .catch((error: Error) =>
          log.warn({ reason: error.message }, 'could not queue the answer timeout'),
        );
      return { outcome: 'needs_input' };
    }

    // Only ask_shops this turn (it has nothing else to do while they answer): wait for them.
    if (askedShops > 0 && turn.toolCalls.every((c) => c.name === 'ask_shops') && !wasForced) {
      return goWaiting(deps, errand, log);
    }

    if (wasForced) {
      await fail(deps, errand.id, wasForced, state, log);
      return { outcome: 'failed' };
    }
  }
}

/**
 * WAITING_FOR_SHOPS: no model call is held open. It wakes when every request has left PINGING or
 * after the shorter of the resume timer and what is left of the total wait. If the requests are
 * already settled (enough learned stock, or shops answered while we moved) it wakes at once.
 */
async function goWaiting(deps: RunDeps, errand: ErrandRecord, log: Logger): Promise<RunResult> {
  const { limits } = deps;
  const left = Math.max(1, limits.maxWaitMs - errand.waitedMs);
  const waitMs = Math.min(limits.resumeAfterMs, left);
  const moved = await moveErrand(deps.db, errand.id, { event: 'ASKED_SHOPS', waitMs }, deps.events);
  if (moved.kind !== 'applied') return { outcome: 'busy' };
  log.info({ waitMs, waitedMs: errand.waitedMs }, 'errand waiting for shops');

  if ((await resumeIfDue(deps, errand.id)) === 'resumed') {
    await wake(deps, errand.id, 'r');
  } else {
    const latest = (await findErrand(deps.db, errand.id)) as ErrandRecord;
    await deps
      .enqueue?.(errand.id, { delayMs: waitMs, key: `w${latest.version}` })
      .catch((error: Error) =>
        log.warn({ reason: error.message }, 'could not queue the wait timer'),
      );
  }
  return { outcome: 'waiting' };
}

async function recordToolStep(
  deps: RunDeps,
  errandId: string,
  call: ToolCall,
  summary: Record<string, unknown>,
  result: unknown,
  latencyMs: number,
) {
  await recordStep(
    deps.db,
    errandId,
    {
      kind: 'tool',
      toolName: call.name,
      args: call.args,
      resultSummary: summary,
      payload: { id: call.id, name: call.name, result },
      latencyMs,
    },
    deps.events,
  );
}

async function runTool(
  deps: RunDeps,
  requests: RequestsContext,
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
        errandId: errand.id,
        requests,
        maxAskShops: deps.limits.maxAskShops,
        maxQuestions: deps.limits.maxQuestions,
        logger: log,
        ai: deps.ai,
        userId: errand.userId,
        where: { lat: errand.lat, lng: errand.lng },
        delivery: { wants: errand.wantsDelivery, addressId: errand.deliveryAddressId },
        requestId: errand.requestId,
        trigramThreshold: deps.trigramThreshold,
        maxItems: deps.limits.maxItems,
        task: errand.task,
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
      const confirmations = await listConfirmations(deps.db, errand.id, {
        lat: errand.lat,
        lng: errand.lng,
      });
      plan = await buildPlan(deps.db, errand, outcome.submitted, confirmations, new Date(), {
        fewerStopsMaxExtraPaise: deps.limits.fewerStopsMaxExtraPaise,
        resolved: state.resolved,
        refused: state.refused,
        named: namedFragments(errand.task),
      });
      const confirmed = plan.items.filter((i) => i.status === 'confirmed').length;
      const likely = plan.items.filter((i) => i.status === 'likely').length;
      outcome = {
        ...outcome,
        summary: {
          confirmed,
          likely,
          notFound: plan.items.length - confirmed - likely,
          items: plan.items.length,
          recommended: plan.recommended,
          // Where what the customer said and what was found differ, for the progress list.
          matched: plan.items
            .filter((i) => i.matchedAs && i.itemName !== null)
            .map((i) => ({ text: i.text, itemName: i.itemName, status: i.status })),
        },
      };
    } catch (error) {
      log.warn({ tool: call.name, err: error }, 'errand plan check failed');
      outcome = {
        result: { error: 'the plan could not be checked; submit it again' },
        summary: { error: true },
      };
    }
  }
  await recordToolStep(
    deps,
    errand.id,
    call,
    outcome.summary,
    outcome.result,
    Date.now() - started,
  );
  return {
    result: outcome.result,
    plan,
    question: outcome.question,
    asked: outcome.asked,
    confirm: outcome.confirm,
  };
}
