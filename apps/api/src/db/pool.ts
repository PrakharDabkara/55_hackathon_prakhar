import pg from 'pg';
import type { Logger } from 'pino';

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
  const pool = new pg.Pool({ connectionString, ...options });
  pool.on('error', (err: Error & { code?: string }) => {
    logger.warn(
      { code: err.code, reason: err.message },
      'idle database client error; the pool dropped it and will open a new one',
    );
  });
  return pool;
}
