import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { AutopilotJob, JobQueue } from '../modules/demo/index.js';
import { logJobFailure } from './jobLog.js';
import { closeWithin, connect, QUEUE_TIMEOUT_MS, withTimeout } from './redis.js';
import { retainedJobs } from './jobRetention.js';

export const DEMO_AUTOPILOT_QUEUE = 'demo-autopilot';

/** A few at a time: the answers are small, and the free instance is shared with real customers. */
export const DEMO_AUTOPILOT_CONCURRENCY = 3;

export interface DemoAutopilotWorker extends JobQueue {
  queue: Queue;
  close(): Promise<void>;
}

interface Options {
  redisUrl: string;
  logger: Logger;
  /** Runs one job. Must not throw. */
  run: (job: AutopilotJob) => Promise<void>;
  queueName?: string;
  concurrency?: number;
}

/**
 * The autopilot's job queue (ADR-0062): plan jobs and delayed answer jobs on BullMQ, a few at a
 * time. Idle, the worker only waits on Redis (no database). One attempt: a failed answer is
 * counted by the autopilot, never retried behind its back. Finished jobs stay ten minutes so a
 * repeated event with the same id is a no-op.
 */
export function startDemoAutopilotWorker({
  redisUrl,
  logger,
  run,
  queueName = DEMO_AUTOPILOT_QUEUE,
  concurrency = DEMO_AUTOPILOT_CONCURRENCY,
}: Options): DemoAutopilotWorker {
  const queueConnection = connect(redisUrl, logger);
  const workerConnection = connect(redisUrl, logger);
  const queue = new Queue(queueName, { connection: queueConnection, ...retainedJobs });
  queue.on('error', (err) => logger.warn({ reason: err.message }, 'demo autopilot queue error'));

  const worker = new Worker(queueName, async (job) => run(job.data as AutopilotJob), {
    connection: workerConnection,
    concurrency,
  });
  worker.on('error', (err) => logger.warn({ reason: err.message }, 'demo autopilot worker error'));
  worker.on('failed', (job, err) => logJobFailure(logger, queueName, job, err));

  return {
    queue,
    async enqueue(job, { jobId, delayMs }) {
      return withTimeout(
        (async () => {
          if (await queue.getJob(jobId)) return false;
          await queue.add('demo', job, {
            jobId,
            ...(delayMs !== undefined && { delay: Math.max(0, Math.round(delayMs)) }),
            attempts: 1,
          });
          return true;
        })(),
        QUEUE_TIMEOUT_MS,
        'queueing the demo autopilot job',
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
