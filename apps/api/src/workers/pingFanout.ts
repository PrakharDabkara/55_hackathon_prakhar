import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { Database } from '../db/queryable.js';
import type { EventPublisher } from '../modules/realtime/index.js';
import { fanOutPings } from '../modules/requests/index.js';
import { createPingDedupe, type RedisLike } from './pingDedupe.js';
import { closeWithin, connect, QUEUE_TIMEOUT_MS, withTimeout } from './redis.js';

export const FANOUT_QUEUE = 'ping-fanout';

export interface PingFanout {
  queue: Queue;
  /** Queue the fan-out for a request that just went PINGING. Job id `fanout-<requestId>`. */
  enqueue(requestId: string): Promise<void>;
  close(): Promise<void>;
}

interface Options {
  redisUrl: string;
  db: Database;
  logger: Logger;
  config: { maxPings: number; dedupeMinutes: number };
  events?: EventPublisher;
  queueName?: string;
}

/**
 * The worker behind `onRequestPinging`: picks shops, applies the 30 minute per-shop dedupe in
 * Redis, and shows the pings. If this job is lost the request is simply never pinged and expires
 * on time; nothing is left half-done.
 */
export function startPingFanout({
  redisUrl,
  db,
  logger,
  config,
  events,
  queueName = FANOUT_QUEUE,
}: Options): PingFanout {
  const queueConnection = connect(redisUrl, logger);
  const workerConnection = connect(redisUrl, logger);
  // The dedupe must fail fast: it gives up after a second and lets the ping through.
  const dedupeConnection = connect(redisUrl, logger, {
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
  });
  const dedupe = createPingDedupe(
    dedupeConnection as unknown as RedisLike,
    logger,
    config.dedupeMinutes,
  );

  const queue = new Queue(queueName, { connection: queueConnection });
  queue.on('error', (err) => logger.warn({ reason: err.message }, 'fan-out queue error'));

  const worker = new Worker(
    queueName,
    async (job) => {
      await fanOutPings(
        { db, logger, config: { maxPings: config.maxPings }, events },
        (job.data as { requestId: string }).requestId,
        dedupe,
      );
    },
    { connection: workerConnection },
  );
  worker.on('error', (err) => logger.warn({ reason: err.message }, 'fan-out worker error'));
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, reason: err.message }, 'fan-out job failed'),
  );

  return {
    queue,
    enqueue: (requestId) =>
      withTimeout(
        queue
          .add(
            'fanout',
            { requestId },
            {
              jobId: `fanout-${requestId}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
              removeOnComplete: true,
              removeOnFail: 100,
            },
          )
          .then(() => undefined),
        QUEUE_TIMEOUT_MS,
        'queueing the ping fan-out',
      ),
    close: () =>
      closeWithin(5000, [
        () => worker.close(),
        () => queue.close(),
        async () => {
          queueConnection.disconnect();
          workerConnection.disconnect();
          dedupeConnection.disconnect();
        },
      ]),
  };
}
