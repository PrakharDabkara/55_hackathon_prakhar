import type { Logger } from 'pino';
import type { Queryable } from '../../db/queryable.js';
import { createAiClient, dbRecorder, type AiClient } from './client.js';
import { createUserLimiter, type RedisCounter, type UserLimiter } from './limiter.js';
import type { LlmProvider } from './types.js';

export { AiUnavailableError, createAiClient, dbRecorder } from './client.js';
export type { AiCallRow, AiClient, Recorder } from './client.js';
export { createFakeProvider } from './fake.js';
export type { FakeCall, FakeChatScript, FakeChatTurn, FakeProvider } from './fake.js';
export { createGeminiProvider } from './gemini.js';
export { createUserLimiter } from './limiter.js';
export type { UserLimiter } from './limiter.js';
export {
  buildResolvePrompt,
  resolveAnswerSchema,
  sanitiseQuery,
  validateAnswer,
} from './resolvePrompt.js';
export type { Candidate, ResolveAnswer, Validated } from './resolvePrompt.js';
export { looksLikeInstruction } from './suspicious.js';
export { aiFromConfig, providerFromConfig } from './fromConfig.js';
export { aiAdminRouter } from './adminRouter.js';
export { InvalidOutputError, ProviderError } from './types.js';
export type {
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
  limiter: UserLimiter;
  /** Embedding: resolve when the best match is at least this similar... */
  embedThreshold: number;
  /** ...and ahead of the second best by at least this much. */
  embedMargin: number;
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
  client?: { timeoutMs?: number; retries?: number; backoffMs?: number };
}

export function createAi({
  provider,
  db,
  logger,
  embedThreshold,
  embedMargin,
  limiter,
  redis = null,
  client = {},
}: Options): AiContext {
  return {
    client: createAiClient({ provider, recorder: dbRecorder(db), logger, ...client }),
    limiter: limiter ?? createUserLimiter({ redis, logger }),
    embedThreshold,
    embedMargin,
  };
}
