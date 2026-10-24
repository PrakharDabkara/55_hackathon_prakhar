import pg from 'pg';
import type { Logger } from 'pino';

/**
 * Limits for the running API. Neon's free compute suspends when idle and the first connection after
 * that takes a few seconds (up to about 10 s on a bad wake), so connecting may wait 15 s before it
 * fails. A statement may run 20 s: longer than the connect wait, far longer than any query the app
 * makes, and under the 30 s at which a browser or proxy has given up anyway. Without them a
 * suspended or stuck database made requests hang instead of fail.
 */
export const APP_POOL_OPTIONS: pg.PoolConfig = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 20_000,
};

/**
 * For one-off scripts (seed:catalog, ai:embed-catalog): a long statement is normal there (a bulk
 * embedding write) and must not be cut off, so no statement timeout and a longer connect wait.
 * Migrations run through node-pg-migrate with its own connection and are not affected either.
 */
export const SCRIPT_POOL_OPTIONS: pg.PoolConfig = {
  connectionTimeoutMillis: 30_000,
  statement_timeout: 0,
};

/**
 * Every Pool in this codebase comes from here. A Pool emits 'error' when an idle connection dies
 * (Postgres restarting, or Neon's free tier suspending an idle compute, both code 57P01), and
 * Node throws an 'error' event nobody listens to: the process would crash. The pool has already
 * discarded the dead client by then, so the right response is to log and carry on; the next query
 * opens a fresh connection.
 *
 * Only the code and message are logged: the error object carries the whole client, password included.
 */
export function createPool(
  connectionString: string,
  logger: Logger,
  options: pg.PoolConfig = {},
): pg.Pool {
  const pool = new pg.Pool({ connectionString, ...APP_POOL_OPTIONS, ...options });
  pool.on('error', (err: Error & { code?: string }) => {
    logger.warn(
      { code: err.code, reason: err.message },
      'idle database client error; the pool dropped it and will open a new one',
    );
  });
  return pool;
}
