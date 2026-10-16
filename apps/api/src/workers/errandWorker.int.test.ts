import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog, seedCatalog } from '../modules/catalog/index.js';
import { createAi, createFakeProvider } from '../modules/ai/index.js';
import { createErrand, limitsFromConfig, runErrand } from '../modules/errands/index.js';
import { testConfig } from '../testing/config.js';
import { ORIGIN } from '../testing/fixtures.js';
import { startPostgres, type TestDatabase } from '../testing/startPostgres.js';
import { startRedis } from '../testing/startRedis.js';
import { waitFor } from '../testing/waitFor.js';
import { ERRAND_QUEUE, startErrandWorker, type ErrandWorker } from './errandWorker.js';

const logger = pino({ level: 'silent' });

describe('errand worker (BullMQ)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let redis: Awaited<ReturnType<typeof startRedis>>;
  let userId: string;
  const running: ErrandWorker[] = [];

  beforeAll(async () => {
    [testDb, redis] = await Promise.all([startPostgres(), startRedis()]);
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    userId = (
      await pool.query(
        `INSERT INTO users (phone, role) VALUES ('+919833300777', 'seeker') RETURNING id`,
      )
    ).rows[0].id;
  }, 300_000);

  afterAll(async () => {
    await Promise.all(running.map((w) => w.close()));
    await testDb?.stop();
    await redis?.stop();
  });

  const limits = { ...limitsFromConfig(testConfig()), userHourlyLimit: 1000 };
  const newErrand = () =>
    createErrand({ db: pool, logger, limits }, userId, {
      task: 'namak chahiye',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      requestId: 'req-w',
    });

  function start(queueName: string) {
    const provider = createFakeProvider();
    provider.playChat([
      {
        toolCalls: [
          { name: 'submit_plan', args: { items: [{ text: 'namak', status: 'not_found' }] } },
        ],
      },
    ]);
    const ai = createAi({
      provider,
      db: pool,
      logger,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
    });
    const worker = startErrandWorker({
      redisUrl: redis.url,
      logger,
      queueName,
      run: (errandId) =>
        runErrand({ db: pool, logger, ai, limits, trigramThreshold: 0.4 }, errandId),
    });
    running.push(worker);
    return { worker, provider };
  }

  it('is the "errand" queue with concurrency 1 (the free tier allows 15 model calls a minute)', async () => {
    expect(ERRAND_QUEUE).toBe('errand');
    const { worker } = start('errand-test-config');
    expect(worker.worker.opts.concurrency).toBe(1);
  });

  it('runs a queued errand to PLAN_READY', async () => {
    const { worker } = start('errand-test-run');
    const { id } = await newErrand();
    await worker.enqueue(id);
    const row = await waitFor(
      async () => (await pool.query(`SELECT state FROM errands WHERE id = $1`, [id])).rows[0],
      (r) => r.state !== 'PLANNING',
    );
    expect(row.state).toBe('PLAN_READY');
  });

  it('queues one job per errand: the job id is errand-<id>, so a second enqueue changes nothing', async () => {
    const { worker, provider } = start('errand-test-dupe');
    const { id } = await newErrand();
    await Promise.all([worker.enqueue(id), worker.enqueue(id), worker.enqueue(id)]);
    await waitFor(
      async () => (await pool.query(`SELECT state FROM errands WHERE id = $1`, [id])).rows[0],
      (r) => r.state !== 'PLANNING',
    );
    await worker.enqueue(id);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(provider.calls.filter((c) => c.kind === 'chat')).toHaveLength(1);
    expect(await worker.queue.getJob(`errand-${id}`)).toBeTruthy();
  });
});
