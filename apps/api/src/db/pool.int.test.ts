import { Writable } from 'node:stream';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, type TestDatabase } from '../testing/startPostgres.js';
import { waitFor } from '../testing/waitFor.js';
import { createPool, SCRIPT_POOL_OPTIONS } from './pool.js';
import { withTransaction } from './queryable.js';

/**
 * Postgres drops connections with 57P01 ("terminating connection due to administrator command")
 * when it shuts down, and Neon's free tier does the same when it suspends an idle compute.
 * Without an 'error' listener on the Pool, Node throws that as an uncaught exception.
 */
describe('losing a database connection', () => {
  let db: TestDatabase;
  const crashes: unknown[] = [];
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'debug' },
    new Writable({
      write(chunk, _enc, done) {
        lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        done();
      },
    }),
  );
  const onCrash = (err: unknown) => crashes.push(err);

  beforeAll(async () => {
    process.on('uncaughtException', onCrash);
    process.on('unhandledRejection', onCrash);
    db = await startPostgres();
  }, 300_000);

  afterAll(async () => {
    process.off('uncaughtException', onCrash);
    process.off('unhandledRejection', onCrash);
    await db?.stop();
  });

  /** What a database shutdown or a Neon suspend does to one connection. */
  async function terminateBackend(pid: number) {
    const admin = new pg.Client({ connectionString: db.url });
    admin.on('error', () => undefined);
    await admin.connect();
    try {
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    } finally {
      await admin.end();
    }
  }

  it('logs a warning for an idle connection that is terminated, does not throw, and reconnects', async () => {
    lines.length = 0;
    const pool = createPool(db.url, logger);
    try {
      const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await terminateBackend((rows[0] as { pid: number }).pid); // the client is idle in the pool

      const warning = await waitFor(
        async () =>
          lines.find((l) => l['level'] === 40 && /idle database client/.test(String(l['msg']))),
        (found) => found !== undefined,
        10_000,
      );
      expect(warning).toBeDefined();
      expect(warning).toMatchObject({ code: '57P01' });
      expect(String(warning?.['reason'])).toMatch(/terminating connection/);

      // No credentials or connection details in the log.
      const logged = JSON.stringify(lines);
      expect(logged).not.toContain(db.url);
      expect(logged).not.toContain('postgres://');
      expect(logged).not.toMatch(/"password"/);

      expect(crashes).toEqual([]);
      // The pool threw the dead client away; the next query gets a fresh one.
      expect((await pool.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
      expect(crashes).toEqual([]);
    } finally {
      await pool.end();
    }
  });

  it('a connection lost in the middle of a transaction fails that transaction, not the process', async () => {
    const pool = createPool(db.url, logger);
    try {
      await expect(
        withTransaction(pool, async (tx) => {
          const { rows } = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          await terminateBackend((rows[0] as { pid: number }).pid);
          await new Promise((resolve) => setTimeout(resolve, 300)); // idle between two queries
          await tx.query('SELECT 1');
        }),
      ).rejects.toThrow();

      expect(crashes).toEqual([]);
      expect((await pool.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    } finally {
      await pool.end();
    }
  });

  it('an app pool cuts a statement off at its timeout, a script pool does not', async () => {
    const app = createPool(db.url, logger, { statement_timeout: 300 });
    const script = createPool(db.url, logger, SCRIPT_POOL_OPTIONS);
    try {
      await expect(app.query('SELECT pg_sleep(2)')).rejects.toMatchObject({ code: '57014' });
      expect((await script.query('SHOW statement_timeout')).rows).toEqual([
        { statement_timeout: '0' },
      ]);
      await expect(script.query('SELECT pg_sleep(0.6)')).resolves.toBeDefined();
      // The default app pool really sets 20 s on the server side.
      const def = createPool(db.url, logger);
      try {
        expect((await def.query('SHOW statement_timeout')).rows).toEqual([
          { statement_timeout: '20s' },
        ]);
      } finally {
        await def.end();
      }
    } finally {
      await app.end();
      await script.end();
    }
  });

  it('an unreachable database fails at connectionTimeoutMillis instead of waiting', async () => {
    // 192.0.2.1 is reserved for documentation (RFC 5737): packets are dropped, nothing answers.
    const pool = createPool('postgres://u:p@192.0.2.1:5432/db', logger, {
      connectionTimeoutMillis: 300,
    });
    const started = Date.now();
    try {
      await expect(pool.query('SELECT 1')).rejects.toThrow(/timeout/i);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await pool.end();
    }
  });
});
