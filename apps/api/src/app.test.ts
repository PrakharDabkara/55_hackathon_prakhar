import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config/config.js';

const config: Config = {
  nodeEnv: 'test',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://unused',
  otpMode: 'simulated',
  trigramThreshold: 0.4,
  redisUrl: null,
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
  errandMaxItems: 10,
  errandMaxSteps: 8,
  errandTokenBudget: 20_000,
  errandUserHourlyLimit: 5,
  errandTaskMaxChars: 500,
  errandAiTimeoutMs: 30_000,
  errandMaxAskShops: 6,
  errandMaxQuestions: 2,
  errandResumeAfterMs: 45_000,
  errandMaxWaitMs: 300_000,
  errandAnswerTimeoutMs: 600_000,
  errandExpiryMs: 900_000,
  errandResumeDebounceMs: 1000,
  geminiFallbackModel: null,
  gitSha: 'abc1234',
};
const logger = pino({ level: 'silent' });

function build(query: () => Promise<unknown>) {
  const db = { query: vi.fn(query) };
  return { app: createApp({ config, logger, db: db as never, readyTimeoutMs: 50 }), db };
}

describe('request id', () => {
  it('echoes an incoming x-request-id', async () => {
    const { app } = build(async () => ({}));
    const res = await request(app).get('/health').set('x-request-id', 'req-42');
    expect(res.headers['x-request-id']).toBe('req-42');
  });

  it('generates one when absent', async () => {
    const { app } = build(async () => ({}));
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /health', () => {
  it('is 200 with sha and uptime and never touches the database', async () => {
    const { app, db } = build(async () => {
      throw new Error('db down');
    });
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', sha: 'abc1234' });
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /ready', () => {
  it('is 200 when Postgres answers', async () => {
    const { app } = build(async () => ({ rows: [{ ok: 1 }] }));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is 503 when the query fails, without leaking the error', async () => {
    const { app } = build(async () => {
      throw new Error('password authentication failed for s3cret');
    });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('s3cret');
  });

  it('is 503 when the query hangs past the timeout', async () => {
    const { app } = build(() => new Promise(() => {}));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
  });
});
