import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { createAiClient, dbRecorder, type AiClient } from './client.js';
import { pingAi, type PingResult } from './ping.js';
import { createUserLimiter, type RedisCounter, type UserLimiter } from './limiter.js';
import type { LlmProvider, Purpose } from './types.js';

export { AiUnavailableError, createAiClient, dbRecorder, MAX_RETRIES } from './client.js';
export type { AiCallRow, AiClient, Recorder } from './client.js';
export { createFakeProvider } from './fake.js';
export type { FakeCall, FakeChatScript, FakeChatTurn, FakeProvider } from './fake.js';
export { createGeminiProvider } from './gemini.js';
export {
  assertNoPrivateData,
  findPrivateData,
  PrivacyGuardError,
  redactPrivateData,
} from './privacyGuard.js';
export type { PrivacyViolation } from './privacyGuard.js';
export { REQUEST_TIMEOUT_MS, withRequestTimeout } from './timeout.js';
export { QuotaWatch, rateLimitInfo, watchProvider } from './quota.js';
export type { RateLimitInfo } from './quota.js';
export { createUserLimiter } from './limiter.js';
export { RESOLVE_BUDGET_MS, withDeadline } from './deadline.js';
export type { UserLimiter } from './limiter.js';
export {
  buildResolvePrompt,
  resolveAnswerSchema,
  sanitiseQuery,
  validateAnswer,
} from './resolvePrompt.js';
export type { Candidate, ResolveAnswer, Validated } from './resolvePrompt.js';
export { buildListResolvePrompt, resolveListAnswerSchema } from './resolveListPrompt.js';
export type { ListPromptLine, ResolveListAnswer } from './resolveListPrompt.js';
export { pingAi } from './ping.js';
export type { PingResult } from './ping.js';
export { classifyError, redactApiKeys, sanitiseMessage } from './failure.js';
export { looksLikeInstruction } from './suspicious.js';
export { aiFromConfig, providerFromConfig } from './fromConfig.js';
export { aiAdminRouter } from './adminRouter.js';
export { InvalidOutputError, ProviderError } from './types.js';
export type {
  FailureKind,
  ChatMessage,
  ChatTool,
  ChatWithToolsOptions,
  ChatWithToolsResult,
  EmbedPurpose,
  LlmProvider,
  Purpose,
  ToolCall,
  Usage,
} from './types.js';

/** What the resolution pipeline needs from AI. */
export interface AiContext {
  client: AiClient;
  /** A tiny call with each configured model, for the admin health check. */
  ping(): Promise<PingResult[]>;
  limiter: UserLimiter;
  /** Embedding: resolve when the best match is at least this similar... */
  embedThreshold: number;
  /** ...and ahead of the second best by at least this much. */
  embedMargin: number;
  /** The most a Find waits on the AI in total (default 15 s, see withDeadline). */
  resolveBudgetMs?: number;
}

interface Options {
  provider: LlmProvider;
  db: Queryable;
  logger: Logger;
  embedThreshold: number;
  embedMargin: number;
  /** Default: a Redis counter if `redis` is given, else no limit. */
  limiter?: UserLimiter;
  redis?: RedisCounter | null;
  resolveBudgetMs?: number;
  client?: {
    timeoutMs?: number;
    purposeTimeoutMs?: Partial<Record<Purpose, number>>;
    models?: Partial<Record<Purpose, { model: string; fallbackModel: string | null }>>;
    retries?: number;
    backoffMs?: number;
    hedgeAfterMs?: number;
    onRetry?: () => void;
  };
}

export function createAi({
  provider,
  db,
  logger,
  embedThreshold,
  embedMargin,
  limiter,
  redis = null,
  resolveBudgetMs,
  client = {},
}: Options): AiContext {
  const aiClient = createAiClient({ provider, recorder: dbRecorder(db), logger, ...client });
  return {
    client: aiClient,
    ping: () => pingAi(provider, aiClient),
    limiter: limiter ?? createUserLimiter({ redis, logger }),
    embedThreshold,
    embedMargin,
    ...(resolveBudgetMs !== undefined && { resolveBudgetMs }),
  };
}
