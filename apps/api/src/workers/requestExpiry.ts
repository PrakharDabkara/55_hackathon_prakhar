import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Database } from '../db/queryable.js';
import { expireRequest, findOverdueRequestIds } from '../modules/requests/index.js';

export const EXPIRY_QUEUE = 'request-expiry';

/** The job fires a moment after the deadline, so clock skew between us and the database never makes it early. */
const SLACK_MS = 250;
const SWEEP_BATCH = 100;

export interface RequestExpiry {
  queue: Queue;
  /** Queue a delayed job for the deadline. Job id `expire-<requestId>` makes it idempotent. */
  schedule(requestId: string, expiresAt: Date): Promise<void>;
  /** Expire every overdue request now; returns how many it looked at. */
  sweepNow(): Promise<number>;
  close(): Promise<void>;
}

interface Options {
  redisUrl: string;
  db: Database;
  logger: Logger;
  sweepEveryMs?: number;
  queueName?: string;
}

/**
 * Makes request expiry timely (ADR-0015). Postgres holds the deadline and is the truth: if Redis
 * loses a job, or the free instance slept through it, the sweeper and lazy expiry on read still
 * expire the request. This queue only makes that happen on time.
 */
export function startRequestExpiry({
  redisUrl,
  db,
  logger,
  sweepEveryMs = 60_000,
  queueName = EXPIRY_QUEUE,
}: Options): RequestExpiry {
  const connect = () => {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // An unhandled 'error' event would crash the process; Redis being away is survivable.
    connection.on('error', (err: Error) =>
      logger.warn({ reason: err.message }, 'redis connection error'),
    );
    return connection;
  };
  const queueConnection = connect();
  const workerConnection = connect();
  const queue = new Queue(queueName, { connection: queueConnection });
  const deps = { db, logger };

  const sweepNow = async () => {
    const ids = await findOverdueRequestIds(db, SWEEP_BATCH);
    for (const id of ids) await expireRequest(deps, id, 'sweeper');
    return ids.length;
  };

  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name === 'expire') {
        await expireRequest(deps, (job.data as { requestId: string }).requestId, 'queue');
      } else if (job.name === 'sweep') {
        await sweepNow();
      }
    },
    { connection: workerConnection },
  );
  worker.on('error', (err) => logger.warn({ reason: err.message }, 'expiry worker error'));
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, reason: err.message }, 'expiry job failed'),
  );

  // Repeatable sweeper; upsert so restarts and several instances share one schedule.
  const ready = queue
    .upsertJobScheduler('sweep', { every: sweepEveryMs }, { name: 'sweep' })
    .then(() => undefined);
  ready.catch((err: Error) =>
    logger.warn({ reason: err.message }, 'could not start expiry sweeper'),
  );

  return {
    queue,
    async schedule(requestId, expiresAt) {
      await ready;
      await queue.add(
        'expire',
        { requestId },
        {
          jobId: `expire-${requestId}`,
          delay: Math.max(0, expiresAt.getTime() - Date.now()) + SLACK_MS,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    },
    sweepNow,
    async close() {
      await worker.close();
      await queue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
    },
  };
}
