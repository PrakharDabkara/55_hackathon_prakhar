import type { DefaultJobOptions, Queue } from 'bullmq';
import type { Logger } from 'pino';

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

/**
 * What every queue keeps once a job is done. Without it BullMQ keeps every finished job forever,
 * and the 60 s expiry sweep alone adds 1,440 a day to a 25 MB Redis (ADR-0064). Failed jobs stay
 * a week so a bad night can still be looked at. Used as each Queue's defaultJobOptions and in the
 * sweep scheduler's template; jobs that add their own removeOnComplete (keyed pushes) win.
 */
export const JOB_RETENTION = {
  removeOnComplete: { age: HOUR_S, count: 200 },
  removeOnFail: { age: 7 * DAY_S, count: 500 },
} as const satisfies DefaultJobOptions;

/** Queue options every worker file passes alongside its connection. */
export const retainedJobs = { defaultJobOptions: JOB_RETENTION };

interface CleanOptions {
  /** Completed jobs finished longer ago than this go. Default 1 hour. */
  graceMs?: number;
  batchSize?: number;
  maxBatches?: number;
}

/**
 * Clears completed jobs that piled up before retention existed. Only the completed set is touched:
 * never waiting, active, delayed (the autopilot's) or failed. Bounded (maxBatches x batchSize per
 * call) and idempotent: a second run finds nothing more. Returns how many it removed.
 */
export async function cleanOldCompletedJobs(
  queue: Queue,
  logger: Logger,
  { graceMs = HOUR_S * 1000, batchSize = 1000, maxBatches = 50 }: CleanOptions = {},
): Promise<number> {
  let removed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const ids = await queue.clean(graceMs, batchSize, 'completed');
    removed += ids.length;
    if (ids.length < batchSize) break;
  }
  logger.info({ queue: queue.name, removed }, 'removed old completed jobs');
  return removed;
}

/** At worker start: one pass per queue; a failure is logged and never stops start-up. */
export async function cleanOldJobs(
  queues: { queue: Queue | null | undefined; graceMs?: number }[],
  logger: Logger,
): Promise<void> {
  for (const { queue, graceMs } of queues) {
    if (!queue) continue;
    try {
      await cleanOldCompletedJobs(queue, logger, graceMs === undefined ? {} : { graceMs });
    } catch (error) {
      logger.warn(
        { queue: queue.name, reason: (error as Error).message },
        'could not remove old completed jobs',
      );
    }
  }
}
