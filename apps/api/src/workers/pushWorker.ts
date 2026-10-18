import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { DeliverResult, PushJob } from '../modules/push/index.js';
import { closeWithin, connect, QUEUE_TIMEOUT_MS, withTimeout } from './redis.js';

export const PUSH_QUEUE = 'push';

/** Tries per push: the first and four retries, backing off 5 s, 10 s, 20 s, 40 s. */
const ATTEMPTS = 5;
const BACKOFF_MS = 5000;

export interface PushWorker {
  queue: Queue;
  /**
   * Queue one push for one browser. With a `key`, a second push with the same key and browser is
   * ignored for a day (a burst of answers is one notification); `delayMs` holds it back first.
   */
  enqueue(job: PushJob, options?: { key?: string; delayMs?: number }): Promise<void>;
  close(): Promise<void>;
}

interface Options {
  redisUrl: string;
  logger: Logger;
  /** Sends one push; throws for a failure worth retrying. */
  deliver(job: PushJob): Promise<DeliverResult>;
  queueName?: string;
  backoffMs?: number;
}

/**
 * The "push" queue (ADR-0034). Sending happens here, after the commit that caused it, so a slow or
 * failing push service never holds up an answer, an order or a request. Retries are per browser.
 */
export function startPushWorker({
  redisUrl,
  logger,
  deliver,
  queueName = PUSH_QUEUE,
  backoffMs = BACKOFF_MS,
}: Options): PushWorker {
  const queueConnection = connect(redisUrl, logger);
  const workerConnection = connect(redisUrl, logger);
  const queue = new Queue(queueName, { connection: queueConnection });
  queue.on('error', (err) => logger.warn({ reason: err.message }, 'push queue error'));

  const worker = new Worker(queueName, async (job) => void (await deliver(job.data as PushJob)), {
    connection: workerConnection,
  });
  worker.on('error', (err) => logger.warn({ reason: err.message }, 'push worker error'));
  worker.on('failed', (job, err) =>
    logger.warn(
      { subscriptionId: (job?.data as PushJob | undefined)?.subscriptionId, reason: err.message },
      'push job failed',
    ),
  );

  return {
    queue,
    enqueue: (job, options = {}) =>
      withTimeout(
        queue
          .add('push', job, {
            ...(options.key && { jobId: `${options.key}:${job.subscriptionId}` }),
            ...(options.delayMs && { delay: options.delayMs }),
            attempts: ATTEMPTS,
            backoff: { type: 'exponential', delay: backoffMs },
            // A kept key is what makes "once per request" hold; plain pushes leave no trace.
            removeOnComplete: options.key ? { age: 24 * 3600 } : true,
            removeOnFail: 100,
          })
          .then(() => undefined),
        QUEUE_TIMEOUT_MS,
        'queueing a push',
      ),
    close: () =>
      closeWithin(5000, [
        () => worker.close(),
        () => queue.close(),
        async () => {
          queueConnection.disconnect();
          workerConnection.disconnect();
        },
      ]),
  };
}
