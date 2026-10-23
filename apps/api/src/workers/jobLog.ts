import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { describeUnexpected } from '../http/errors.js';
import { currentRequestId } from '../http/requestContext.js';

/** Job data plus the id of the request that queued it, when there was one. */
export function withCorrelation<T extends object>(data: T): T & { correlationId?: string } {
  const correlationId = currentRequestId();
  return correlationId ? { ...data, correlationId } : data;
}

/**
 * One line for a failed job: which queue and job, which attempt of how many, the request that
 * queued it, and the error's class, SQLSTATE and constraint. The error goes through the logger's
 * serializer (phones and emails cut); the job's data is never logged.
 */
export function logJobFailure(
  logger: Logger,
  queue: string,
  job: Job | undefined,
  err: Error,
  level: 'error' | 'warn' = 'error',
): void {
  const correlationId = (job?.data as { correlationId?: unknown } | undefined)?.correlationId;
  logger[level](
    {
      queue,
      jobName: job?.name,
      jobId: job?.id,
      attempt: job ? job.attemptsMade : undefined,
      maxAttempts: job?.opts?.attempts,
      ...(typeof correlationId === 'string' && { requestId: correlationId, correlationId }),
      ...describeUnexpected(err),
      err,
    },
    'job failed',
  );
}
