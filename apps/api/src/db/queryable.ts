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
  // While we hold a client the pool is not listening to it. If its connection dies between two of
  // our queries, pg emits 'error' on the client and, with no listener, Node would throw. The next
  // query rejects, which fails the transaction; we only need to keep the process alive and make
  // sure the dead client is thrown away instead of going back into the pool.
  let broken: Error | undefined;
  const onError = (err: Error) => {
    broken = err;
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.removeListener('error', onError);
    client.release(broken);
  }
}
