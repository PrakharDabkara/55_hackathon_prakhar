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
  workersEnabled: false,
  gitSha: 'test',
  ...overrides,
});
