import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, type TestDatabase } from '../../testing/startPostgres.js';
import { resetDemo } from './index.js';

/**
 * PR F1. A checked-out pg client has no listener from the Pool. When its connection dies, pg emits
 * 'error' on the client and Node throws if nobody listens (observed with Postgres 17 stopped and
 * with pg_terminate_backend: scripts/probe/record-local-failures.ts, testing/observed/postgres.json).
 * db/queryable.ts withTransaction guards for this; the demo lock (withDemoLock) holds a client for
 * the whole seed or reset and does not.
 */
describe('the demo seed/reset lock connection', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startPostgres();
  }, 300_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  /** Runs a reset and reports the 'error' listeners on the client holding the advisory lock. */
  async function listenersOnLockClient(): Promise<number> {
    let held: pg.PoolClient | undefined;
    let listeners = -1;
    const probe = new Error('stop here: the lock client has been inspected');
    const db = {
      query: async () => {
        // The first query inside the lock: the lock client is checked out and holds the lock.
        listeners = held?.listenerCount('error') ?? -1;
        throw probe;
      },
      connect: async () => (held = await testDb.pool.connect()),
    };
    const error = await resetDemo({
      db: db as never,
      logger: pino({ level: 'silent' }),
      capBytes: 1_000_000,
    }).catch((e) => e);
    expect(error).toBe(probe);
    return listeners;
  }

  it(
    'has an error listener while it holds the connection, so a dropped connection cannot crash the process',
    async () => {
      expect(await listenersOnLockClient()).toBeGreaterThan(0);
    },
  );

  it('releases the lock again after a failure, so the next reset can run', async () => {
    await listenersOnLockClient();
    const { rows } = await testDb.pool.query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 6200062`,
    );
    expect(rows).toHaveLength(0);
  });
});
