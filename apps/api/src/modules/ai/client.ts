import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { classifyError, type Failure } from './failure.js';
import { ModelHealth, nextMidnightPacific, type ModelStateView } from './modelHealth.js';
import {
  ProviderError,
  type ChatWithToolsOptions,
  type ChatWithToolsResult,
  type EmbedPurpose,
  type EmbedResult,
  type FailureKind,
  type GenerateJsonOptions,
  type GenerateJsonResult,
  type LlmProvider,
  type Purpose,
} from './types.js';

export type Outcome = 'ok' | FailureKind;

export type { ModelStateView } from './modelHealth.js';

/** One model role (chat, errand, embedding) as /admin/health/details shows it. */
export interface ModelStatus {
  role: 'chat' | 'errand' | 'embedding';
  /** The model that answers right now; null when none can. */
  activeModel: string | null;
  primary: ModelStateView;
  fallback: ModelStateView | null;
}

/** One row of ai_calls. There is deliberately no field for prompt text. */
export interface AiCallRow {
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  outcome: Outcome;
  requestId: string | null;
}

export interface Recorder {
  /** Returns the new row's id, or null if it could not be written. */
  record(row: AiCallRow): Promise<string | null>;
  markInvalid(callId: string): Promise<void>;
}

/** The AI could not help this time. Callers degrade; they never fail the user's search. */
export class AiUnavailableError extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind) {
    super(`AI unavailable: ${kind}`);
    this.name = 'AiUnavailableError';
    this.kind = kind;
  }
}

export interface AiClient {
  readonly providerName: string;
  readonly embedModel: string;
  generateJson<T>(
    options: GenerateJsonOptions<T> & { requestId?: string },
  ): Promise<GenerateJsonResult<T> & { callId: string | null }>;
  embed(
    texts: string[],
    purpose: EmbedPurpose,
    requestId?: string,
  ): Promise<EmbedResult & { callId: string | null }>;
  /** The time limit a call of this purpose gets (resolve is short, errand calls are long). */
  timeoutFor(purpose: Purpose): number;
  /** Per role: the active model, and the state of the primary and the fallback. */
  modelStatus(): ModelStatus[];
  /** The models a call of this purpose tries: the primary, and the fallback if there is one. */
  modelsFor(purpose: Purpose): { model: string; fallbackModel: string | null };
  /** One tool-using model turn (the errand agent). Gets a longer time limit than a short JSON call. */
  chatWithTools(
    options: ChatWithToolsOptions & { requestId?: string; timeoutMs?: number; retries?: number },
  ): Promise<ChatWithToolsResult & { callId: string | null }>;
  /** The answer parsed but broke a rule (for example an item outside the shortlist). */
  markInvalid(callId: string | null): Promise<void>;
}

interface Options {
  provider: LlmProvider;
  recorder: Recorder;
  timeoutMs?: number;
  /** Longer (or shorter) limits for some purposes; the rest use `timeoutMs`. */
  purposeTimeoutMs?: Partial<Record<Purpose, number>>;
  /**
   * A model (and fallback) for some purposes; the rest use the provider's own. The errand agent
   * can run on a different model from query resolution, whose gate was proven on another one.
   */
  models?: Partial<Record<Purpose, { model: string; fallbackModel: string | null }>>;
  /** Extra attempts after the first, only for timeouts, network drops, 429 and 5xx. At most 3. */
  retries?: number;
  /** The first pause between attempts; it doubles each time, with jitter, up to 30 s. */
  backoffMs?: number;
  /** A number in [0, 1) for the jitter; tests pass their own. */
  random?: () => number;
  /**
   * The longest total wait for a rate limit's retryDelay, per purpose. A delay that does not fit
   * is not waited for: the fallback model answers instead. Interactive calls get little room.
   */
  waitBudgetMs?: Partial<Record<Purpose, number>>;
  /**
   * A short call (resolve, classify) whose primary model has not answered after this many ms also
   * goes to the fallback model; the first valid answer wins and the other call is cancelled.
   * 0 turns it off. Default 4000.
   */
  hedgeAfterMs?: number;
  /** Called before each retry's pause, so a script can count them. */
  onRetry?: () => void;
  breaker?: { threshold?: number; cooldownMs?: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 8000;
/** No call is retried more than this many times, whatever the caller asks for. */
export const MAX_RETRIES = 3;
/** The longest backoff pause before a retry. A pause Google asked for (retryDelay) is not capped. */
export const MAX_PAUSE_MS = 30_000;

/**
 * How long a call may wait in total for a rate limit to clear. A person is waiting on a search
 * (and an 8 s limit), so a 56 s delay is not worth it; the errand agent and the catalog job run
 * in the background and can wait a minute.
 */
const DEFAULT_WAIT_BUDGET_MS: Record<Purpose, number> = {
  resolve_query: 10_000,
  classify_item: 10_000,
  embed_query: 10_000,
  errand: 90_000,
  embed_catalog: 90_000,
};

/**
 * The pause before retry number `attempt` (0 for the first): Google's own Retry-After when a 429
 * carries one, else the backoff doubled each time with jitter (between half and the full step).
 * A backoff is never over 30 s; Google's own delay is returned whole (the caller checks it fits).
 */
export function retryPauseMs(
  failure: Failure,
  attempt: number,
  backoffMs: number,
  random: () => number,
): number {
  if (failure.retryAfterSec !== undefined) return failure.retryAfterSec * 1000;
  const step = Math.min(backoffMs * 2 ** attempt, MAX_PAUSE_MS);
  return Math.round(step * (0.5 + random() / 2));
}

/** Timeouts and network drops are worth another try; so are 429 and 5xx. Other 4xx are not. */
const retryable = (failure: Failure) =>
  !failure.perDay && // a spent daily quota will not come back in seconds
  (failure.kind === 'timeout' ||
    failure.kind === 'network' ||
    (failure.kind === 'http' &&
      failure.status !== undefined &&
      (failure.status === 429 || failure.status >= 500)));

/** What the next attempt should run on: the fallback model after a timeout, dropped connection, 429 or 503. */
const wantsFallback = (failure: Failure) =>
  failure.kind === 'timeout' ||
  failure.kind === 'network' ||
  (failure.kind === 'http' && (failure.status === 429 || failure.status === 503));

/** The purposes that are short enough to be worth a second model alongside a slow first one. */
const HEDGED_PURPOSES = new Set<Purpose>(['resolve_query', 'classify_item']);
export const DEFAULT_HEDGE_AFTER_MS = 4000;

/** Both models of a hedged call failed. `primary` is the failure the failure rules go by. */
class HedgeFailed extends Error {
  constructor(
    readonly primary: unknown,
    readonly hedge: unknown,
  ) {
    super('both hedged models failed');
  }
}

function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  cancel?: AbortSignal,
): Promise<T> {
  const abort = new AbortController();
  cancel?.addEventListener('abort', () => abort.abort(), { once: true });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new ProviderError(`no answer within ${ms} ms`, undefined, { kind: 'timeout' }));
    }, ms);
  });
  const call = run(abort.signal);
  call.catch(() => undefined); // a late failure after the timeout must not be unhandled
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Wraps a provider with what every caller needs: a time limit per purpose (8 s by default), retries
 * with a pause (doubling, with jitter, at most 30 s, or Google's own Retry-After) on timeouts, network drops, 429 and 5xx, a fallback model for the attempts after a
 * timeout, 429 or 503, a circuit breaker per purpose (5 failures in a row: skip AI for 60 seconds,
 * then one trial call), at most 3 retries and none for a spent daily quota, one ai_calls row per call, and one log line per failed attempt with its
 * kind, status and code. A failure here is an AiUnavailableError for the caller to absorb.
 */
export function createAiClient({
  provider,
  recorder,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  purposeTimeoutMs = {},
  models = {},
  retries = 1,
  backoffMs = 500,
  random = Math.random,
  hedgeAfterMs = DEFAULT_HEDGE_AFTER_MS,
  onRetry,
  waitBudgetMs = {},
  breaker: { threshold = 5, cooldownMs = 60_000 } = {},
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger,
}: Options): AiClient {
  // One breaker per purpose: query resolution failing must not stop errands, nor the reverse, and
  // a success of one must not hide the failures of the other.
  const breakers = new Map<string, { failures: number; openUntil: number }>();
  const breakerFor = (purpose: string) => {
    let state = breakers.get(purpose);
    if (!state) breakers.set(purpose, (state = { failures: 0, openUntil: 0 }));
    return state;
  };
  const timeoutFor = (purpose: Purpose) => purposeTimeoutMs[purpose] ?? timeoutMs;
  // What this process knows about each model's quota and existence (in memory; a restart resets it).
  const health = new ModelHealth(now);
  const isEmbed = (purpose: Purpose) => purpose === 'embed_query' || purpose === 'embed_catalog';
  const budgetFor = (purpose: Purpose) => waitBudgetMs[purpose] ?? DEFAULT_WAIT_BUDGET_MS[purpose];
  /** The models of a purpose. Embeddings have no fallback model, so they keep the trigram path. */
  const modelsOf = (purpose: Purpose) => {
    const own = models[purpose];
    return {
      own,
      primary: isEmbed(purpose) ? provider.embedModel : (own?.model ?? provider.model),
      fallback: isEmbed(purpose) ? null : own ? own.fallbackModel : provider.fallbackModel,
    };
  };

  const record = async (row: Omit<AiCallRow, 'provider'>): Promise<string | null> => {
    try {
      return await recorder.record({ ...row, provider: provider.name });
    } catch (error) {
      logger?.warn({ reason: (error as Error).message }, 'could not write ai_calls row');
      return null;
    }
  };

  /** Runs one logical call: breaker, model health, timeout, retry, failover, audit row. */
  async function run<
    R extends { usage: { inputTokens: number; outputTokens: number }; latencyMs: number },
  >(
    purpose: Purpose,
    requestId: string | undefined,
    call: (signal: AbortSignal, model: string | undefined) => Promise<R>,
    limitMs: number,
    requestedRetries: number,
  ): Promise<R & { callId: string | null }> {
    const maxRetries = Math.min(requestedRetries, MAX_RETRIES);
    const state = breakerFor(purpose);
    const { own, primary: primaryModel, fallback: fallbackName } = modelsOf(purpose);
    const base = { purpose, requestId: requestId ?? null };
    const skipped = async (kind: 'breaker' | 'http', message: string) => {
      logger?.warn(
        { purpose, model: primaryModel, attempt: 0, kind, latencyMs: 0, requestId },
        message,
      );
      await record({
        ...base,
        model: primaryModel,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        outcome: kind,
      });
      throw new AiUnavailableError(kind);
    };
    if (now() < state.openUntil) await skipped('breaker', 'AI call skipped');

    // The model this call starts on: the primary, or the fallback while the primary is used up or gone.
    let current = primaryModel;
    const switchTo = (to: string, reason: string) => {
      logger?.warn({ purpose, from: current, to, reason, requestId }, 'AI model switched');
      current = to;
    };
    if (!health.usable(primaryModel)) {
      if (fallbackName && health.usable(fallbackName))
        switchTo(fallbackName, `primary ${health.get(primaryModel).state}`);
      else await skipped('http', 'AI call skipped: no model is available');
    }
    /** The fallback, if this call is on the primary and the fallback is usable. */
    const spare = () =>
      current === primaryModel && fallbackName && health.usable(fallbackName) ? fallbackName : null;

    /**
     * A failure of a hedged call's side: the rules that mark a model used up or gone hold for it
     * as for any call, whichever side it was on and whoever answered first.
     */
    const noteHedgeFailure = (model: string, error: unknown) => {
      const failure = classifyError(error);
      if (failure.modelGone) {
        if (health.markUnavailable(model, `model not found (${failure.status})`))
          logger?.error({ purpose, model, status: failure.status }, 'AI model is unavailable');
      } else if (failure.status === 429 && failure.perDay) {
        health.markExhausted(
          model,
          failure.retryAfterSec !== undefined
            ? now() + failure.retryAfterSec * 1000
            : nextMidnightPacific(now()),
          `daily quota (${failure.quotaId ?? 'per day'})`,
        );
      }
    };

    /**
     * The primary gets `hedgeAfterMs` to answer alone. After that the fallback model is asked the
     * same question; the first valid answer wins and the other call is cancelled.
     */
    async function hedged(
      named: string | undefined,
      fallbackModel: string,
    ): Promise<{ result: R; hedgedWith: string | null }> {
      const primaryCancel = new AbortController();
      const primaryCall = withTimeout(
        (signal) => call(signal, named),
        limitMs,
        primaryCancel.signal,
      );
      primaryCall.catch(() => undefined);
      let timer: NodeJS.Timeout | undefined;
      const early = await Promise.race([
        primaryCall.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        ),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), hedgeAfterMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (early) {
        if ('error' in early) throw early.error;
        return { result: early.value, hedgedWith: null };
      }

      logger?.info(
        { purpose, requestId, primary: primaryModel, hedge: fallbackModel, afterMs: hedgeAfterMs },
        'AI hedge started',
      );
      const hedgeCancel = new AbortController();
      const hedgeCall = withTimeout(
        (signal) => call(signal, fallbackModel),
        limitMs,
        hedgeCancel.signal,
      );
      return new Promise((resolve, reject) => {
        const errors: { primary?: unknown; hedge?: unknown } = {};
        let failed = 0;
        const finish = (winner: string, result: R, loser: AbortController) => {
          loser.abort();
          logger?.info(
            {
              purpose,
              requestId,
              primary: primaryModel,
              hedge: fallbackModel,
              afterMs: hedgeAfterMs,
              winner,
            },
            'AI call hedged',
          );
          resolve({ result, hedgedWith: fallbackModel });
        };
        const lost = (side: 'primary' | 'hedge', model: string, error: unknown) => {
          noteHedgeFailure(model, error);
          errors[side] = error;
          if (++failed === 2) reject(new HedgeFailed(errors.primary, errors.hedge));
        };
        primaryCall.then(
          (r) => finish(primaryModel, r, hedgeCancel),
          (e: unknown) => lost('primary', primaryModel, e),
        );
        hedgeCall.then(
          (r) => finish(fallbackModel, r, primaryCancel),
          (e: unknown) => lost('hedge', fallbackModel, e),
        );
      });
    }

    const started = now();
    let waited = 0;
    let bare429 = 0;
    for (let attempt = 0; ; attempt++) {
      const model = current;
      const attemptStarted = now();
      try {
        // The provider's own primary is its default; a per-purpose model is named on every call.
        const named =
          model !== primaryModel ? model : !isEmbed(purpose) && own ? own.model : undefined;
        const hedgeWith =
          hedgeAfterMs > 0 && HEDGED_PURPOSES.has(purpose) && model === primaryModel
            ? spare()
            : null;
        const result = hedgeWith
          ? (await hedged(named, hedgeWith)).result
          : await withTimeout((signal) => call(signal, named), limitMs);
        state.failures = 0;
        const answeredBy =
          result && 'model' in result ? String((result as { model: string }).model) : model;
        if (model !== primaryModel) {
          logger?.info(
            { purpose, model: answeredBy, attempt, fallback: true },
            'AI call answered by the fallback model',
          );
        }
        const callId = await record({
          ...base,
          model: answeredBy,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
          outcome: 'ok',
        });
        return { ...result, callId };
      } catch (caught) {
        // Both models of a hedged call failed: that was the whole try, so nothing is retried.
        const bothFailed = caught instanceof HedgeFailed;
        const error = bothFailed ? caught.primary : caught;
        const failure = classifyError(error);
        logger?.warn(
          {
            purpose,
            model,
            attempt,
            kind: failure.kind,
            status: failure.status,
            code: failure.code,
            quotaId: failure.quotaId,
            retryDelaySec: failure.retryAfterSec,
            latencyMs: now() - attemptStarted,
            message: failure.message,
            requestId,
          },
          'AI call failed',
        );

        // What to do next: 'again' = go round once more (on `current`), or fall out and fail.
        let again = false;
        const used = (reason: string, until: number) => {
          health.markExhausted(model, until, reason);
          const to = spare();
          if (to) {
            switchTo(to, reason);
            again = true;
          }
        };
        const otherwise = (): boolean => attempt < maxRetries && retryable(failure);

        if (bothFailed) {
          // Nothing more to try: both were asked and the health rules were applied to each.
        } else if (failure.kind === 'invalid_output' || failure.requestTooLarge) {
          // The service worked (or this request can never fit): not a reason to open the breaker.
          state.failures = 0;
        } else if (failure.modelGone) {
          const reason = `model not found (${failure.status})`;
          if (health.markUnavailable(model, reason))
            logger?.error({ purpose, model, status: failure.status }, 'AI model is unavailable');
          const to = spare();
          if (to) {
            switchTo(to, reason);
            again = true;
          }
        } else if (failure.status === 429 && failure.perDay) {
          used(
            `daily quota (${failure.quotaId ?? 'per day'})`,
            failure.retryAfterSec !== undefined
              ? now() + failure.retryAfterSec * 1000
              : nextMidnightPacific(now()),
          );
        } else if (failure.status === 429 && !failure.quotaFailure) {
          // A bare 429: retry once, and if it comes again, treat it as the daily limit.
          if (bare429++ === 0 && attempt < maxRetries) {
            onRetry?.();
            await sleep(retryPauseMs(failure, attempt, backoffMs, random));
            again = true;
          } else if (bare429 > 1) {
            used(
              'rate limited twice with no quota detail (treated as daily)',
              nextMidnightPacific(now()),
            );
          }
        } else if (failure.status === 429 && failure.retryAfterSec !== undefined) {
          // A per-minute (or tokens-per-minute) limit with a stated delay: wait it out in full if
          // that fits this call's budget, else let the fallback model answer this call.
          const waitMs = failure.retryAfterSec * 1000;
          if (attempt < maxRetries && waited + waitMs <= budgetFor(purpose)) {
            waited += waitMs;
            onRetry?.();
            await sleep(waitMs);
            again = true;
          } else {
            const to = spare();
            if (to) {
              switchTo(
                to,
                `rate limited, retryDelay ${failure.retryAfterSec} s is over the budget`,
              );
              again = true;
            }
          }
        } else if (otherwise()) {
          const to = wantsFallback(failure) ? spare() : null;
          if (to) switchTo(to, `${failure.kind} ${failure.status ?? failure.code ?? ''}`.trim());
          onRetry?.();
          await sleep(retryPauseMs(failure, attempt, backoffMs, random));
          again = true;
        }

        if (again) continue;
        if (failure.kind !== 'invalid_output' && !failure.requestTooLarge) {
          if (++state.failures >= threshold) state.openUntil = now() + cooldownMs;
        }
        await record({
          ...base,
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: now() - started,
          outcome: failure.kind,
        });
        throw new AiUnavailableError(failure.kind);
      }
    }
  }

  return {
    providerName: provider.name,
    embedModel: provider.embedModel,
    timeoutFor,
    generateJson: ({ requestId, ...options }) =>
      run(
        options.purpose,
        requestId,
        (signal, model) => provider.generateJson({ ...options, signal, ...(model && { model }) }),
        timeoutFor(options.purpose),
        retries,
      ),
    chatWithTools: ({ requestId, timeoutMs: limit, retries: attempts, ...options }) =>
      run(
        options.purpose,
        requestId,
        (signal, model) => provider.chatWithTools({ ...options, signal, ...(model && { model }) }),
        limit ?? timeoutFor(options.purpose),
        attempts ?? retries,
      ),
    modelStatus() {
      const roles: [ModelStatus['role'], Purpose][] = [
        ['chat', 'resolve_query'],
        ['errand', 'errand'],
        ['embedding', 'embed_query'],
      ];
      return roles.map(([role, purpose]) => {
        const { primary, fallback } = modelsOf(purpose);
        const active = [primary, fallback].find((m) => m && health.usable(m)) ?? null;
        return {
          role,
          activeModel: active,
          primary: health.view(primary),
          fallback: fallback ? health.view(fallback) : null,
        };
      });
    },
    modelsFor(purpose) {
      const own = models[purpose];
      return own
        ? { model: own.model, fallbackModel: own.fallbackModel }
        : { model: provider.model, fallbackModel: provider.fallbackModel };
    },
    embed: (texts, purpose, requestId) =>
      run(
        purpose,
        requestId,
        (signal) => provider.embed(texts, purpose, signal),
        timeoutFor(purpose),
        retries,
      ),
    async markInvalid(callId) {
      if (!callId) return;
      try {
        await recorder.markInvalid(callId);
      } catch (error) {
        logger?.warn({ reason: (error as Error).message }, 'could not mark ai_calls row');
      }
    },
  };
}
createAiClient.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

/** Writes ai_calls rows to Postgres. */
export function dbRecorder(db: Queryable): Recorder {
  return {
    async record(row) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO ai_calls (purpose, provider, model, input_tokens, output_tokens, latency_ms, outcome, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          row.purpose,
          row.provider,
          row.model,
          row.inputTokens,
          row.outputTokens,
          Math.round(row.latencyMs),
          row.outcome,
          row.requestId,
        ],
      );
      return rows[0]?.id ?? null;
    },
    async markInvalid(callId) {
      await db.query(`UPDATE ai_calls SET outcome = 'invalid_output' WHERE id = $1`, [callId]);
    },
  };
}
