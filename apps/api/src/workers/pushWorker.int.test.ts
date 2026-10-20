import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeliverResult } from '../modules/push/index.js';
import { startRedis } from '../testing/startRedis.js';
import { waitFor } from '../testing/waitFor.js';
import { startPushWorker, type PushWorker } from './pushWorker.js';

const logger = pino({ level: 'silent' });
const payload = {
  title: 'New request: atta · under 1 km',
  body: 'Open the shop to answer',
  tag: 'shop-requests',
  renotify: true,
  url: '/app/shop',
};

// ADR-0034: sends go through their own BullMQ queue, so a push service having a bad minute costs a retry.
describe('push queue', () => {
  let redis: Awaited<ReturnType<typeof startRedis>>;
  const running: PushWorker[] = [];
  beforeAll(async () => {
    redis = await startRedis();
  }, 120_000);
  afterAll(async () => {
    await Promise.all(running.map((w) => w.close()));
    await redis?.stop();
  });

  const start = (deliver: (job: { subscriptionId: string }) => Promise<DeliverResult>) => {
    const worker = startPushWorker({
      redisUrl: redis.url,
      logger,
      deliver: (job) => deliver(job),
      queueName: `push-${Math.random().toString(36).slice(2)}`,
      backoffMs: 50,
    });
    running.push(worker);
    return worker;
  };

  it('delivers a queued push', async () => {
    const seen: string[] = [];
    const worker = start(async (job) => {
      seen.push(job.subscriptionId);
      return 'sent';
    });
    await worker.enqueue({ subscriptionId: 'sub-1', payload });
    await waitFor(
      async () => seen,
      (s) => s.length > 0,
    );
    expect(seen).toEqual(['sub-1']);
  });

  it('retries when the push service fails, and stops once it works', async () => {
    let calls = 0;
    const worker = start(async () => {
      calls++;
      if (calls < 3) throw new Error('503 from the push service');
      return 'sent';
    });
    await worker.enqueue({ subscriptionId: 'sub-1', payload });
    await waitFor(
      async () => calls,
      (n) => n >= 3,
    );
    expect(calls).toBe(3);
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toBe(3);
  });

  it('gives up after 5 tries', async () => {
    let calls = 0;
    const worker = start(async () => {
      calls++;
      throw new Error('push service down');
    });
    await worker.enqueue({ subscriptionId: 'sub-1', payload });
    await waitFor(
      async () => calls,
      (n) => n >= 5,
    );
    await new Promise((r) => setTimeout(r, 600));
    expect(calls).toBe(5);
  });

  it('does not retry a push that was dropped for good (a 410, a 400)', async () => {
    let calls = 0;
    const worker = start(async () => {
      calls++;
      return 'gone';
    });
    await worker.enqueue({ subscriptionId: 'sub-1', payload });
    await waitFor(
      async () => calls,
      (n) => n >= 1,
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toBe(1);
  });

  it('queues one push per key: a burst of answers to one request is one notification', async () => {
    const seen: string[] = [];
    const worker = start(async (job) => {
      seen.push(job.subscriptionId);
      return 'sent';
    });
    await worker.enqueue({ subscriptionId: 'sub-1', payload }, { key: 'answer:r1', delayMs: 300 });
    await worker.enqueue({ subscriptionId: 'sub-1', payload }, { key: 'answer:r1', delayMs: 300 });
    await worker.enqueue({ subscriptionId: 'sub-2', payload }, { key: 'answer:r1', delayMs: 300 });
    await waitFor(
      async () => seen,
      (s) => s.length >= 2,
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(seen.sort()).toEqual(['sub-1', 'sub-2']);
  });

  it('holds a delayed push back until its time', async () => {
    const started = Date.now();
    let at = 0;
    const worker = start(async () => {
      at = Date.now() - started;
      return 'sent';
    });
    await worker.enqueue({ subscriptionId: 'sub-1', payload }, { delayMs: 800 });
    await waitFor(
      async () => at,
      (n) => n > 0,
    );
    expect(at).toBeGreaterThanOrEqual(700);
  });
});
