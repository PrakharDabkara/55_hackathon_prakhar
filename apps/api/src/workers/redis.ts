import { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** A Redis connection whose errors are logged, not thrown: an unhandled 'error' event kills the process. */
export function connect(
  url: string,
  logger: Logger,
  options: { maxRetriesPerRequest?: number | null; commandTimeout?: number } = {},
): Redis {
  const connection = new Redis(url, { maxRetriesPerRequest: null, ...options });
  connection.on('error', (err: Error) =>
    logger.warn({ reason: err.message }, 'redis connection error'),
  );
  return connection;
}

/** Rejects if `promise` has not settled in `ms`: with Redis away, commands otherwise wait forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs the close steps in order but gives up after `ms`, so shutdown cannot hang on a dead Redis. */
export async function closeWithin(ms: number, steps: (() => Promise<unknown>)[]): Promise<void> {
  const run = (async () => {
    for (const step of steps) await step();
  })();
  run.catch(() => undefined);
  await withTimeout(run, ms, 'close').catch(() => undefined);
}

/** How long a producer waits for Redis before giving up on queueing a job. */
export const QUEUE_TIMEOUT_MS = 2000;
