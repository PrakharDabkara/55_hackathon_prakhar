import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { Database } from '../db/queryable.js';
import type { EventPublisher } from '../modules/realtime/index.js';
import {
  expireRequest,
  findOverdueRequestIds,
  findUnpingedRequestIds,
} from '../modules/requests/index.js';
import { logJobFailure, withCorrelation } from './jobLog.js';
import { closeWithin, connect, QUEUE_TIMEOUT_MS, withTimeout } from './redis.js';
import { JOB_RETENTION, retainedJobs } from './jobRetention.js';

export const EXPIRY_QUEUE = 'request-expiry';

/** The job fires a moment after the deadline, so clock skew between us and the database never makes it early. */
const SLACK_MS = 250;
const SWEEP_BATCH = 100;
const UNPINGED_AFTER_SECONDS = 30;

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
  /** Re-queue the ping fan-out for a request that never got its pings. */
  enqueueFanout?: (requestId: string) => Promise<void>;
  /** Tells the seeker and the shops when a request expires. */
  events?: EventPublisher;
  /** More work for the same 60 s sweep (the errand sweeper); returns how many it touched. */
  extraSweeps?: (() => Promise<number>)[];
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
  enqueueFanout,
  events,
  extraSweeps = [],
}: Options): RequestExpiry {
  const queueConnection = connect(redisUrl, logger);
  const workerConnection = connect(redisUrl, logger);
  const queue = new Queue(queueName, { connection: queueConnection, ...retainedJobs });
  queue.on('error', (err) => logger.warn({ reason: err.message }, 'expiry queue error'));
  const deps = { db, logger, events };

  const sweepNow = async () => {
    const ids = await findOverdueRequestIds(db, SWEEP_BATCH);
    for (const id of ids) await expireRequest(deps, id, 'sweeper');

    // Same sweep, second job: a request still PINGING with no pings after 30 s lost its fan-out
    // job. Same job id as the original, so it can never run twice at once.
    let requeued = 0;
    if (enqueueFanout) {
      for (const id of await findUnpingedRequestIds(db, UNPINGED_AFTER_SECONDS, SWEEP_BATCH)) {
        await enqueueFanout(id);
        requeued++;
      }
      if (requeued > 0) logger.info({ requeued }, 'sweeper re-queued lost ping fan-out jobs');
    }
    let extra = 0;
    for (const sweep of extraSweeps) {
      try {
        extra += await sweep();
      } catch (error) {
        logger.warn({ reason: (error as Error).message }, 'an extra sweep failed');
      }
    }
    return ids.length + requeued + extra;
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
  worker.on('failed', (job, err) => logJobFailure(logger, queueName, job, err));

  // Repeatable sweeper; upsert so restarts and several instances share one schedule.
  const ready = queue
    .upsertJobScheduler('sweep', { every: sweepEveryMs }, { name: 'sweep', opts: JOB_RETENTION })
    .then(() => undefined);
  ready.catch((err: Error) =>
    logger.warn({ reason: err.message }, 'could not start expiry sweeper'),
  );

  return {
    queue,
    async schedule(requestId, expiresAt) {
      await withTimeout(
        (async () => {
          await ready;
          await queue.add('expire', withCorrelation({ requestId }), {
            jobId: `expire-${requestId}`,
            delay: Math.max(0, expiresAt.getTime() - Date.now()) + SLACK_MS,
            removeOnComplete: true,
          });
        })(),
        QUEUE_TIMEOUT_MS,
        'queueing the expiry job',
      );
    },
    sweepNow,
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
