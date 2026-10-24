import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createPool, SCRIPT_POOL_OPTIONS } from './pool.js';

const logger = pino({ level: 'silent' });
const url = 'postgres://u:p@localhost:5/db';

/**
 * The limits are generous on purpose. Neon's free compute suspends when idle and its first
 * connection after that takes a few seconds (up to about 10 s in a bad case), so connecting may
 * wait 15 s. A statement may run 20 s: longer than the connect wait, far longer than any query the
 * app makes (the slowest, the demo reset, runs as many short statements), and still under the
 * 30 s a browser or proxy gives up at.
 */
describe('createPool limits (R2)', () => {
  it('app pools wait at most 15 s to connect and 20 s per statement', async () => {
    const pool = createPool(url, logger);
    expect(pool.options.connectionTimeoutMillis).toBe(15_000);
    expect(pool.options.statement_timeout).toBe(20_000);
    await pool.end();
  });

  it('a caller can override them', async () => {
    const pool = createPool(url, logger, { connectionTimeoutMillis: 1, statement_timeout: 2 });
    expect(pool.options.connectionTimeoutMillis).toBe(1);
    expect(pool.options.statement_timeout).toBe(2);
    await pool.end();
  });

  it('scripts (seed, embed-catalog) have no statement timeout and a longer connect wait', async () => {
    const pool = createPool(url, logger, SCRIPT_POOL_OPTIONS);
    expect(pool.options.statement_timeout).toBe(0);
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThanOrEqual(30_000);
    await pool.end();
  });
});
