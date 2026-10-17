import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { classifyError, type Failure } from './failure.js';
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
  /** Extra attempts after the first, only for 429 and 5xx. */
  retries?: number;
  backoffMs?: number;
  breaker?: { threshold?: number; cooldownMs?: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** Timeouts and network drops are worth another try; so are 429 and 5xx. Other 4xx are not. */
const retryable = (failure: Failure) =>
  failure.kind === 'timeout' ||
  failure.kind === 'network' ||
  (failure.kind === 'http' &&
    failure.status !== undefined &&
    (failure.status === 429 || failure.status >= 500));

/** What the next attempt should run on: the fallback model after a timeout, 429 or 503. */
const wantsFallback = (failure: Failure) =>
  failure.kind === 'timeout' ||
  (failure.kind === 'http' && (failure.status === 429 || failure.status === 503));

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const abort = new AbortController();
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
 * with a pause on timeouts, network drops, 429 and 5xx, a fallback model for the attempts after a
 * timeout, 429 or 503, a circuit breaker per purpose (5 failures in a row: skip AI for 60 seconds,
 * then one trial call), one ai_calls row per call, and one log line per failed attempt with its
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

  const record = async (row: Omit<AiCallRow, 'provider'>): Promise<string | null> => {
    try {
      return await recorder.record({ ...row, provider: provider.name });
    } catch (error) {
      logger?.warn({ reason: (error as Error).message }, 'could not write ai_calls row');
      return null;
    }
  };

  /** Runs one logical call: breaker, timeout, retry, fallback, audit row. */
  async function run<
    R extends { usage: { inputTokens: number; outputTokens: number }; latencyMs: number },
  >(
    purpose: Purpose,
    requestId: string | undefined,
    call: (signal: AbortSignal, model: string | undefined) => Promise<R>,
    limitMs: number,
    maxRetries: number,
  ): Promise<R & { callId: string | null }> {
    const state = breakerFor(purpose);
    const own = models[purpose];
    const primaryModel = own?.model ?? provider.model;
    const fallbackName = own ? own.fallbackModel : provider.fallbackModel;
    const base = { purpose, requestId: requestId ?? null };
    if (now() < state.openUntil) {
      logger?.warn(
        { purpose, model: primaryModel, attempt: 0, kind: 'breaker', latencyMs: 0 },
        'AI call skipped',
      );
      await record({
        ...base,
        model: primaryModel,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        outcome: 'breaker',
      });
      throw new AiUnavailableError('breaker');
    }

    const started = now();
    let useFallback = false;
    for (let attempt = 0; ; attempt++) {
      const fallback = useFallback ? fallbackName : null;
      const model = fallback ?? primaryModel;
      const attemptStarted = now();
      try {
        // The provider's own primary is its default; a per-purpose model is named on every call.
        const named = fallback ?? (own ? own.model : undefined);
        const result = await withTimeout((signal) => call(signal, named), limitMs);
        state.failures = 0;
        const answeredBy =
          result && 'model' in result ? String((result as { model: string }).model) : model;
        if (fallback) {
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
      } catch (error) {
        const failure = classifyError(error);
        logger?.warn(
          {
            purpose,
            model,
            attempt,
            kind: failure.kind,
            status: failure.status,
            code: failure.code,
            latencyMs: now() - attemptStarted,
            message: failure.message,
          },
          'AI call failed',
        );
        if (failure.kind === 'invalid_output') {
          // The service worked, so this is not a reason to open the breaker.
          state.failures = 0;
        } else if (attempt < maxRetries && retryable(failure)) {
          if (fallbackName && wantsFallback(failure)) useFallback = true;
          await sleep(backoffMs * 2 ** attempt);
          continue;
        } else if (++state.failures >= threshold) {
          state.openUntil = now() + cooldownMs;
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
