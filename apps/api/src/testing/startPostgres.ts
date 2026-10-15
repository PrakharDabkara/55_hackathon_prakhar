import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { GenericContainer } from 'testcontainers';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const IMAGE = 'kahanmilega-postgres:test';

export interface TestDatabase {
  pool: Pool;
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
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
