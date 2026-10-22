import type { Logger } from 'pino';
import type { Config } from '../../config/config.js';
import type { Queryable } from '../../db/queryable.js';
import { connect } from '../../workers/redis.js';
import { createFakeProvider } from './fake.js';
import { createGeminiProvider } from './gemini.js';
import { withRequestTimeout } from './timeout.js';
import { loadScenario, playScenario } from './scenario.js';
import { createAi, type AiContext } from './index.js';
import type { LlmProvider, Purpose } from './types.js';

export function providerFromConfig(config: Config, logger?: Logger): LlmProvider {
  if (config.llmProvider === 'gemini') {
    // Every request has a hard limit, also one that goes through no client (the evals' preflight).
    return withRequestTimeout(
      createGeminiProvider({
        apiKey: config.geminiApiKey as string,
        model: config.geminiModel,
        fallbackModel: config.geminiFallbackModel,
        embedModel: config.geminiEmbedModel,
        embedDim: config.embedDim,
        ...(logger && { logger }),
      }),
    );
  }
  const fake = createFakeProvider({ dim: config.embedDim });
  // A scripted model for end-to-end runs: FAKE_LLM_SCENARIO=<file> (ADR-0024 amendment, Day 14b).
  if (config.fakeLlmScenario) playScenario(fake, loadScenario(config.fakeLlmScenario));
  return fake;
}

/** The AI the running API (and the scripts) use, and how to close its Redis connection. */
export function aiFromConfig({
  config,
  db,
  logger,
  client,
  wrapProvider,
}: {
  config: Config;
  db: Queryable;
  logger: Logger;
  /** Timeout and retry settings; scripts that can afford to wait use more patient ones. */
  client?: {
    timeoutMs?: number;
    purposeTimeoutMs?: Partial<Record<Purpose, number>>;
    models?: Partial<Record<Purpose, { model: string; fallbackModel: string | null }>>;
    retries?: number;
    backoffMs?: number;
    onRetry?: () => void;
  };
  /** Lets a script observe every provider call (the evals watch for an exhausted quota). */
  wrapProvider?: (provider: LlmProvider) => LlmProvider;
}): AiContext & { close(): void } {
  // The per-user limit counter fails fast and open: a slow Redis must never slow a search.
  const redis = config.redisUrl
    ? connect(config.redisUrl, logger, { maxRetriesPerRequest: 1, commandTimeout: 500 })
    : null;
  const ai = createAi({
    provider: wrapProvider
      ? wrapProvider(providerFromConfig(config, logger))
      : providerFromConfig(config, logger),
    db,
    logger,
    embedThreshold: config.embedThreshold,
    embedMargin: config.embedMargin,
    redis,
    client: {
      purposeTimeoutMs: { errand: config.errandAiTimeoutMs },
      // Only the errand agent follows GEMINI_ERRAND_MODEL; resolve keeps GEMINI_MODEL.
      models: { errand: { model: config.errandModel, fallbackModel: config.errandFallbackModel } },
      ...client,
    },
  });
  return { ...ai, close: () => redis?.disconnect() };
}
