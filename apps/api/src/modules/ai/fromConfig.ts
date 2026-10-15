import type { Logger } from 'pino';
import type { Config } from '../../config/config.js';
import type { Queryable } from '../../db/queryable.js';
import { connect } from '../../workers/redis.js';
import { createFakeProvider } from './fake.js';
import { createGeminiProvider } from './gemini.js';
import { createAi, type AiContext } from './index.js';
import type { LlmProvider } from './types.js';

export function providerFromConfig(config: Config): LlmProvider {
  if (config.llmProvider === 'gemini') {
    return createGeminiProvider({
      apiKey: config.geminiApiKey as string,
      model: config.geminiModel,
      embedModel: config.geminiEmbedModel,
      embedDim: config.embedDim,
    });
  }
  return createFakeProvider({ dim: config.embedDim });
}

/** The AI the running API (and the scripts) use, and how to close its Redis connection. */
export function aiFromConfig({
  config,
  db,
  logger,
  client,
}: {
  config: Config;
  db: Queryable;
  logger: Logger;
  /** Timeout and retry settings; scripts that can afford to wait use more patient ones. */
  client?: { timeoutMs?: number; retries?: number; backoffMs?: number };
}): AiContext & { close(): void } {
  // The per-user limit counter fails fast and open: a slow Redis must never slow a search.
  const redis = config.redisUrl
    ? connect(config.redisUrl, logger, { maxRetriesPerRequest: 1, commandTimeout: 500 })
    : null;
  const ai = createAi({
    provider: providerFromConfig(config),
    db,
    logger,
    embedThreshold: config.embedThreshold,
    embedMargin: config.embedMargin,
    redis,
    ...(client && { client }),
  });
  return { ...ai, close: () => redis?.disconnect() };
}
