import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import { logJobFailure, withCorrelation } from './jobLog.js';
import { closeWithin, connect, QUEUE_TIMEOUT_MS, withTimeout } from './redis.js';
import { retainedJobs } from './jobRetention.js';

export const ERRAND_QUEUE = 'errand';

export interface ErrandWorker {
  queue: Queue;
  worker: Worker;
  /**
   * Queue the agent for an errand. Job id `errand-<id>` (plus `-<key>`), so queueing the same
   * thing twice is one job; `delayMs` makes it a timer.
   */
  enqueue(errandId: string, options?: { delayMs?: number; key?: string }): Promise<void>;
  close(): Promise<void>;
}

interface Options {
  redisUrl: string;
  logger: Logger;
  /** Runs the agent for one errand. Must be safe to call twice: the database lease makes it so. */
  run: (errandId: string) => Promise<unknown>;
  queueName?: string;
}

/**
 * The errand agent as a BullMQ job (ADR-0024). Concurrency 1: the free Gemini tier allows 15
 * requests a minute, and one errand makes several. One attempt: a failed errand is FAILED in
 * Postgres with a reason; the job never retries behind its back. Finished jobs stay an hour so a
 * repeated enqueue with the same id stays a no-op.
 */
export function startErrandWorker({
  redisUrl,
  logger,
  run,
  queueName = ERRAND_QUEUE,
}: Options): ErrandWorker {
  const queueConnection = connect(redisUrl, logger);
  const workerConnection = connect(redisUrl, logger);
  const queue = new Queue(queueName, { connection: queueConnection, ...retainedJobs });
  queue.on('error', (err) => logger.warn({ reason: err.message }, 'errand queue error'));

  const worker = new Worker(
    queueName,
    async (job) => {
      await run((job.data as { errandId: string }).errandId);
    },
    { connection: workerConnection, concurrency: 1 },
  );
  worker.on('error', (err) => logger.warn({ reason: err.message }, 'errand worker error'));
  worker.on('failed', (job, err) => logJobFailure(logger, queueName, job, err));

  return {
    queue,
    worker,
    async enqueue(errandId, options = {}) {
      await withTimeout(
        queue.add('run', withCorrelation({ errandId }), {
          jobId: options.key ? `errand-${errandId}-${options.key}` : `errand-${errandId}`,
          ...(options.delayMs !== undefined && {
            delay: Math.max(0, Math.round(options.delayMs)),
          }),
          attempts: 1,
        }),
        QUEUE_TIMEOUT_MS,
        'queueing the errand job',
      );
    },
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
