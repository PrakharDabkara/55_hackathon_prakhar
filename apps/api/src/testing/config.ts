import type { Config } from '../config/config.js';

/** A complete Config for tests; override what a test cares about. */
export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  nodeEnv: 'test',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://unused',
  redisUrl: null,
  otpMode: 'simulated',
  trigramThreshold: 0.4,
  minStockResults: 3,
  requestTtlMinutes: 15,
  maxPingsPerRequest: 10,
  pingDedupeMinutes: 30,
  workersEnabled: false,
  adminPhones: [],
  llmProvider: 'fake',
  geminiApiKey: null,
  geminiModel: 'gemini-3.1-flash-lite',
  geminiEmbedModel: 'gemini-embedding-001',
  embedDim: 768,
  embedThreshold: 0.8,
  embedMargin: 0.03,
  gitSha: 'test',
  ...overrides,
});
