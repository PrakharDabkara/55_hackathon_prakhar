import type { Pool } from 'pg';

/**
 * Waits until no other connection to this database is running a query. A test that closes
 * workers or a timer cannot be sure their last query is done; the next truncate would then
 * queue behind it for table locks. Idle connections are ignored. Fails with the queries still
 * running when `ms` is up, so a stuck query is named instead of waited for.
 */
export async function waitForQuietDb(pool: Pick<Pool, 'query'>, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const { rows } = await pool.query<{ query: string }>(
      `SELECT left(query, 200) AS query FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'active'`,
    );
    if (rows.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `database still not quiet after ${ms} ms; still running:\n${rows.map((r) => r.query).join('\n')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
