import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg, { type Pool } from 'pg';
import { pino } from 'pino';
import { GenericContainer } from 'testcontainers';
import { createPool } from '../db/pool.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const IMAGE = 'askbuy-postgres:test';

export interface TestDatabase {
  pool: Pool;
  /** Connection string, for tests that open their own connections. */
  url: string;
  stop: () => Promise<void>;
}

/** A throwaway Postgres (PostGIS, pgvector, pg_trgm) with every migration applied. */
export async function startPostgres(): Promise<TestDatabase> {
  await GenericContainer.fromDockerfile(path.join(repoRoot, 'infra/postgres')).build(IMAGE, {
    deleteOnExit: false,
  });
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGE).start();
  const databaseUrl = container.getConnectionUri();
  await runner({
    databaseUrl,
    dir: path.join(repoRoot, 'apps/api/migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
  const pool = createPool(databaseUrl, pino({ level: 'silent' }));
  return {
    pool,
    url: databaseUrl,
    // Close the pool, wait until Postgres has really seen every connection go, and only then stop
    // it. pool.end() resolves once the clients are told to leave, not once they have gone; stopping
    // the container in that gap makes Postgres kill them with 57P01.
    stop: async () => {
      await pool.end();
      await waitForConnectionsToClose(databaseUrl);
      await container.stop();
    },
  };
}

async function waitForConnectionsToClose(url: string, timeoutMs = 5000): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND backend_type = 'client backend'`,
      );
      if ((rows[0]?.n ?? 0) === 0 || Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch {
    // The database is already going away; nothing left to wait for.
  } finally {
    await client.end().catch(() => undefined);
  }
}
