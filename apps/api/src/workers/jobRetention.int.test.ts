import { Queue, Worker } from 'bullmq';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRedis } from '../testing/startRedis.js';
import { connect } from './redis.js';
import { cleanOldCompletedJobs, JOB_RETENTION } from './jobRetention.js';
import { startRequestExpiry } from './requestExpiry.js';

const logger = pino({ level: 'silent' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('job retention', () => {
  let redis: Awaited<ReturnType<typeof startRedis>>;
  beforeAll(async () => {
    redis = await startRedis();
  }, 120_000);
  afterAll(async () => {
    await redis?.stop();
  });

  it('keeps the shared options: 1 h or 200 completed, 7 days or 500 failed', () => {
    expect(JOB_RETENTION).toEqual({
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 7 * 24 * 3600, count: 500 },
    });
  });

  it('keeps finished sweep jobs bounded after many runs', async () => {
    let runs = 0;
    const expiry = startRequestExpiry({
      redisUrl: redis.url,
      db: { query: async () => ({ rows: [] }) } as never,
      logger,
      sweepEveryMs: 5,
      queueName: `bounded-${Date.now()}`,
      extraSweeps: [async () => ++runs && 0],
    });
    try {
      const deadline = Date.now() + 30_000;
      while (runs < 400 && Date.now() < deadline) await sleep(100);
      expect(runs).toBeGreaterThanOrEqual(400);
      const completed = await expiry.queue.getJobCounts('completed');
      expect(completed['completed']).toBeLessThanOrEqual(205);
    } finally {
      await expiry.close();
    }
  }, 60_000);

  it('start-up clean-up removes old completed jobs and leaves delayed and failed ones', async () => {
    const name = `cleanup-${Date.now()}`;
    const connection = connect(redis.url, logger);
    const queue = new Queue(name, { connection });
    const worker = new Worker(
      name,
      async (job) => {
        if (job.name === 'bad') throw new Error('boom');
      },
      { connection: connect(redis.url, logger) },
    );
    try {
      for (let i = 0; i < 3; i++) await queue.add('ok', {}, { removeOnFail: false });
      await queue.add('bad', {}, { attempts: 1 });
      const settled = async (completed: number) => {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const c = await queue.getJobCounts('completed', 'failed');
          if ((c['completed'] ?? 0) >= completed && (c['failed'] ?? 0) >= 1) return;
          if (Date.now() > deadline) throw new Error('jobs did not settle');
          await sleep(50);
        }
      };
      await settled(3);
      await sleep(1200);
      for (let i = 0; i < 2; i++) await queue.add('ok', {});
      await settled(5);
      await queue.add('later', {}, { delay: 3_600_000 });

      const removed = await cleanOldCompletedJobs(queue, logger, { graceMs: 1000 });
      expect(removed).toBe(3);
      const counts = await queue.getJobCounts('completed', 'failed', 'delayed');
      expect(counts).toMatchObject({ completed: 2, failed: 1, delayed: 1 });
      // Idempotent: a second run finds nothing more.
      expect(await cleanOldCompletedJobs(queue, logger, { graceMs: 1000 })).toBe(0);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  }, 60_000);

  it('works in capped batches', async () => {
    const name = `batches-${Date.now()}`;
    const connection = connect(redis.url, logger);
    const queue = new Queue(name, { connection });
    const worker = new Worker(name, async () => undefined, {
      connection: connect(redis.url, logger),
    });
    try {
      for (let i = 0; i < 25; i++) await queue.add('ok', {}, { removeOnComplete: false });
      while (((await queue.getJobCounts('completed'))['completed'] ?? 0) < 25) await sleep(50);
      const removed = await cleanOldCompletedJobs(queue, logger, {
        graceMs: 0,
        batchSize: 10,
        maxBatches: 2,
      });
      expect(removed).toBe(20);
      expect((await queue.getJobCounts('completed'))['completed']).toBe(5);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  }, 60_000);
});
