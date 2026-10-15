import type { Pool, PoolClient } from 'pg';

/** Anything with `query`: a pool, a checked-out client, or a test double. */
export type Queryable = Pick<Pool | PoolClient, 'query'>;

/** A pool: can also check out a client for a transaction. */
export type Database = Pick<Pool, 'query' | 'connect'>;

/** Runs `fn` in one transaction on its own connection; rolls back if it throws. */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
