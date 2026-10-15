import { Writable } from 'node:stream';
import type { Pool } from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadSeedCatalog, seedCatalog } from './modules/catalog/index.js';
import { testConfig } from './testing/config.js';
import { ORIGIN } from './testing/fixtures.js';
import { loginAs } from './testing/login.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';
import { startRedis } from './testing/startRedis.js';
import { waitFor } from './testing/waitFor.js';
import { startWorkers, type Workers } from './workers/index.js';

const lines: string[] = [];
const logger = pino(
  { level: 'debug' },
  new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  }),
);

describe('Redis unreachable', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let workers: Workers;
  const crashes: unknown[] = [];
  const onCrash = (err: unknown) => crashes.push(err);

  beforeAll(async () => {
    process.on('unhandledRejection', onCrash);
    process.on('uncaughtException', onCrash);
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
  }, 300_000);

  afterAll(async () => {
    process.off('unhandledRejection', onCrash);
    process.off('uncaughtException', onCrash);
    await workers?.close();
    await testDb?.stop();
  });

  it('still creates the request (201), keeps running, and logs a warning', async () => {
    const config = testConfig({ workersEnabled: true, redisUrl: redis.url });
    workers = startWorkers({ config, db: pool, logger }) as Workers;
    const app = createApp({ config, logger, db: pool, requestHooks: workers.hooks });
    const seeker = await loginAs(app, 'seeker', '9850000001');

    await redis.stop();
    lines.length = 0;

    const res = await request(app)
      .post('/requests')
      .set({ Authorization: `Bearer ${seeker.token}` })
      .send({ q: 'aata', lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('PINGING');

    const warned = await waitFor(
      async () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
      (all) => all.some((l) => l['level'] === 40 && /could not queue/.test(String(l['msg']))),
      10_000,
    );
    expect(warned.some((l) => l['level'] === 40 && /could not queue/.test(String(l['msg'])))).toBe(
      true,
    );

    // Still alive and answering, with no crash from a stray rejection or error event.
    expect((await request(app).get('/health')).status).toBe(200);
    const read = await request(app)
      .get(`/requests/${res.body.id}`)
      .set({ Authorization: `Bearer ${seeker.token}` });
    expect(read.status).toBe(200);
    expect(crashes).toEqual([]);
  }, 60_000);
});
