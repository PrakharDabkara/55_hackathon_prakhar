import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import {
  InvalidOutputError,
  ProviderError,
  type ChatWithToolsOptions,
  type ChatWithToolsResult,
  type EmbedPurpose,
  type EmbedResult,
  type GenerateJsonOptions,
  type GenerateJsonResult,
  type LlmProvider,
} from './types.js';

export type Outcome = 'ok' | 'invalid_output' | 'error' | 'skipped_breaker';

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
  readonly kind: Exclude<Outcome, 'ok'>;
  constructor(kind: Exclude<Outcome, 'ok'>) {
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
  /** Extra attempts after the first, only for 429 and 5xx. */
  retries?: number;
  backoffMs?: number;
  breaker?: { threshold?: number; cooldownMs?: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 8000;
/** A model turn that picks tools reads a longer prompt than a JSON classification. */
const CHAT_TIMEOUT_MS = 30_000;

const retryable = (error: unknown) =>
  error instanceof ProviderError &&
  error.status !== undefined &&
  (error.status === 429 || error.status >= 500);

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new ProviderError(`no answer within ${ms} ms`));
    }, ms);
  });
  const call = run(abort.signal);
  call.catch(() => undefined); // a late failure after the timeout must not be unhandled
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Wraps a provider with what every caller needs: an 8 second limit, one retry with a pause on 429
 * and 5xx, a circuit breaker (5 failures in a row: skip AI for 60 seconds, then one trial call),
 * and one ai_calls row per call. A failure here is an AiUnavailableError for the caller to absorb.
 */
export function createAiClient({
  provider,
  recorder,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 1,
  backoffMs = 500,
  breaker: { threshold = 5, cooldownMs = 60_000 } = {},
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger,
}: Options): AiClient {
  // One breaker per kind of call: a model that cannot generate may still embed, and a success of
  // one must not hide the failures of the other.
  const state = { generate: { failures: 0, openUntil: 0 }, embed: { failures: 0, openUntil: 0 } };

  const record = async (row: Omit<AiCallRow, 'provider'>): Promise<string | null> => {
    try {
      return await recorder.record({ ...row, provider: provider.name });
    } catch (error) {
      logger?.warn({ reason: (error as Error).message }, 'could not write ai_calls row');
      return null;
    }
  };

  /** Runs one logical call: breaker, timeout, retry, audit row. */
  async function run<
    R extends { usage: { inputTokens: number; outputTokens: number }; latencyMs: number },
  >(
    kind: 'generate' | 'embed',
    purpose: string,
    requestId: string | undefined,
    call: (signal: AbortSignal) => Promise<R>,
    limitMs: number = timeoutMs,
    maxRetries: number = retries,
  ): Promise<R & { callId: string | null }> {
    const breaker = state[kind];
    const base = { purpose, model: provider.model, requestId: requestId ?? null };
    if (now() < breaker.openUntil) {
      await record({
        ...base,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        outcome: 'skipped_breaker',
      });
      throw new AiUnavailableError('skipped_breaker');
    }

    const started = now();
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await withTimeout(call, limitMs);
        breaker.failures = 0;
        const callId = await record({
          ...base,
          model:
            result && 'model' in result
              ? String((result as { model: string }).model)
              : provider.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
          outcome: 'ok',
        });
        return { ...result, callId };
      } catch (error) {
        if (error instanceof InvalidOutputError) {
          // The service worked, so this is not a reason to open the breaker.
          breaker.failures = 0;
          await record({
            ...base,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: now() - started,
            outcome: 'invalid_output',
          });
          throw new AiUnavailableError('invalid_output');
        }
        if (attempt < maxRetries && retryable(error)) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        if (++breaker.failures >= threshold) breaker.openUntil = now() + cooldownMs;
        logger?.warn(
          { purpose, status: error instanceof ProviderError ? error.status : undefined },
          'AI call failed',
        );
        await record({
          ...base,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: now() - started,
          outcome: 'error',
        });
        throw new AiUnavailableError('error');
      }
    }
  }

  return {
    providerName: provider.name,
    embedModel: provider.embedModel,
    generateJson: ({ requestId, ...options }) =>
      run('generate', options.purpose, requestId, (signal) =>
        provider.generateJson({ ...options, signal }),
      ),
    chatWithTools: ({ requestId, timeoutMs: limit, retries: attempts, ...options }) =>
      run(
        'generate',
        options.purpose,
        requestId,
        (signal) => provider.chatWithTools({ ...options, signal }),
        limit ?? CHAT_TIMEOUT_MS,
        attempts,
      ),
    embed: (texts, purpose, requestId) =>
      run('embed', purpose, requestId, (signal) => provider.embed(texts, purpose, signal)),
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
