import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createLogger } from '../logger.js';
import { TEST_ADMIN_TOKEN, testConfig } from '../testing/config.js';
import type { OpsProbes } from './adminHealth.js';

const db = {
  query: async () => ({ rows: [{ calls: 12, failed: 2, skipped: 1 }] }),
} as unknown as Parameters<typeof createApp>[0]['db'];

const ops: OpsProbes = {
  redisOk: async () => true,
  queues: async () => [
    { name: 'ping-fanout', waiting: 3, active: 1, delayed: 0, failedLast24h: 2 },
  ],
  autopilot: () => ({ on: true, lastActivityAt: '2026-10-23T10:00:00.000Z' }),
  redisMemory: async () => ({ usedBytes: 5_000_000, maxBytes: 25_000_000 }),
};

const app = (adminToken: string | null) =>
  createApp({
    config: testConfig({ adminToken, gitSha: 'abc1234' }),
    logger: createLogger('silent'),
    db,
    ops,
    webDistDir: '/nonexistent',
  });

describe('GET /admin/health/details (O1)', () => {
  it('is a 404 without the token, with a wrong one, and when no admin token is set', async () => {
    const a = app(TEST_ADMIN_TOKEN);
    expect((await request(a).get('/admin/health/details')).status).toBe(404);
    expect(
      (await request(a).get('/admin/health/details').set('Authorization', 'Bearer nope')).status,
    ).toBe(404);
    expect((await request(app(null)).get('/admin/health/details')).status).toBe(404);
  });

  it('gives counts and states with the token', async () => {
    const res = await request(app(TEST_ADMIN_TOKEN))
      .get('/admin/health/details')
      .set('Authorization', `Bearer ${TEST_ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: { sha: 'abc1234' },
      db: { ok: true },
      redis: { ok: true, usedMemoryBytes: 5_000_000, maxMemoryBytes: 25_000_000 },
      queues: [{ name: 'ping-fanout', waiting: 3, active: 1, delayed: 0, failedLast24h: 2 }],
      ai: { callsToday: 12, failedToday: 2, breakerSkipsToday: 1 },
      autopilot: { on: true, lastActivityAt: '2026-10-23T10:00:00.000Z' },
    });
  });

  it('still answers when Redis is not configured, and says so', async () => {
    const bare = createApp({
      config: testConfig({ adminToken: TEST_ADMIN_TOKEN }),
      logger: createLogger('silent'),
      db,
      webDistDir: '/nonexistent',
    });
    const res = await request(bare)
      .get('/admin/health/details')
      .set('Authorization', `Bearer ${TEST_ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.redis).toEqual({ ok: false, configured: false });
    expect(res.body.queues).toEqual([]);
  });
});
