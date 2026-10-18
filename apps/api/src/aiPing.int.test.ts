import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAi, createFakeProvider, ProviderError } from './modules/ai/index.js';
import { testConfig } from './testing/config.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const logger = pino({ level: 'silent' });
const ADMIN_PHONE = '9810000002';

describe('GET /admin/ai/ping', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  const provider = createFakeProvider({ fallbackModel: 'fb-model' });
  let app: ReturnType<typeof createApp>;
  let closed: ReturnType<typeof createApp>;
  let admin: { token: string };
  let seeker: { token: string };

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { timeoutMs: 200 },
    });
    app = createApp({
      config: testConfig({ adminPhones: [`+91${ADMIN_PHONE}`] }),
      logger,
      db: pool,
      ai,
    });
    closed = createApp({ config: testConfig({ adminPhones: [] }), logger, db: pool, ai });
    admin = await loginAs(app, 'seeker', ADMIN_PHONE);
    seeker = await loginAs(app, 'seeker', '9810000003');
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  const ping = (token: string | null, a = app) => {
    const r = request(a).get('/admin/ai/ping');
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('is for the admin only: 404 for anyone else, and when no admin is configured', async () => {
    expect((await ping(null)).status).toBe(404);
    expect((await ping(seeker.token)).status).toBe(404);
    expect((await ping(admin.token, closed)).status).toBe(404);
  });

  it('returns one result per call and model: ok, kind, status, latency', async () => {
    provider.onGenerate(() => ({ ok: true }));
    provider.onChat(() => ({ toolCalls: [{ name: 'pong', args: {} }] }));
    const res = await ping(admin.token);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('fake');
    expect(res.body.results).toHaveLength(4);
    expect(res.body.results[0]).toEqual({
      purpose: 'resolve_query',
      role: 'primary',
      call: 'generateJson',
      model: 'fake-model',
      ok: true,
      kind: null,
      status: null,
      latencyMs: expect.any(Number),
    });
    expect(res.body.results.map((r: { model: string }) => r.model)).toEqual([
      'fake-model',
      'fb-model',
      'fake-model',
      'fb-model',
    ]);
    expect(res.body.ok).toBe(true);
  });

  it('shows what is wrong, and does not write to ai_calls', async () => {
    await pool.query('TRUNCATE ai_calls');
    provider.onGenerate(() => {
      throw new ProviderError('busy', 503, { code: 'UNAVAILABLE' });
    });
    provider.onChat(() => new Promise(() => undefined));
    const res = await ping(admin.token);
    expect(res.body.ok).toBe(false);
    expect(res.body.results[0]).toMatchObject({ ok: false, kind: 'http', status: 503 });
    expect(res.body.results[2]).toMatchObject({
      purpose: 'errand',
      ok: false,
      kind: 'timeout',
      status: null,
    });
    expect((await pool.query('SELECT count(*)::int AS n FROM ai_calls')).rows[0].n).toBe(0);
  });

  it('answers 503 when no AI is configured', async () => {
    const noAi = createApp({
      config: testConfig({ adminPhones: [`+91${ADMIN_PHONE}`] }),
      logger,
      db: pool,
    });
    const res = await ping(admin.token, noAi);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_not_configured');
  });
});

describe('ai_calls outcomes (migration 011)', () => {
  it('accepts every kind and no longer the old names', async () => {
    const testDb = await startPostgres();
    try {
      const insert = (outcome: string) =>
        testDb.pool.query(
          `INSERT INTO ai_calls (purpose, provider, model, outcome) VALUES ('errand', 'fake', 'm', $1)`,
          [outcome],
        );
      for (const kind of ['ok', 'timeout', 'http', 'network', 'invalid_output', 'breaker', 'other'])
        await insert(kind);
      await expect(insert('error')).rejects.toThrow();
      await expect(insert('skipped_breaker')).rejects.toThrow();
    } finally {
      await testDb.stop();
    }
  }, 300_000);
});
