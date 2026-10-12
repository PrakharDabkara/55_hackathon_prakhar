import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findShopsWithinRadius } from './index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const IMAGE = 'kahanmilega-postgres:test';

// A point in Indore (Rajwada). One degree of latitude is ~111 km, so a shop
// `km` kilometres due north sits `km` kilometres away.
const ORIGIN = { lat: 22.7196, lng: 75.8577 };
const north = (km: number) => ORIGIN.lat + km / 111;

const fixtures = [
  { name: 'Far shop (5 km)', km: 5 },
  { name: 'Just outside (2.1 km)', km: 2.1 },
  { name: 'Near shop (0.5 km)', km: 0.5 },
  { name: 'Just inside (1.9 km)', km: 1.9 },
];

describe('findShopsWithinRadius', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    await GenericContainer.fromDockerfile(path.join(repoRoot, 'infra/postgres')).build(IMAGE, {
      deleteOnExit: false,
    });
    container = await new PostgreSqlContainer(IMAGE).start();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: path.join(repoRoot, 'apps/api/migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => {},
    });

    pool = new Pool({ connectionString: databaseUrl });
    for (const { name, km } of fixtures) {
      await pool.query(
        `INSERT INTO shops (name, phone, categories, location)
         VALUES ($1, '+910000000000', ARRAY['grocery'],
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)`,
        [name, ORIGIN.lng, north(km)],
      );
    }
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('returns only shops within 2000 m, nearest first', async () => {
    const shops = await findShopsWithinRadius(ORIGIN.lat, ORIGIN.lng, 2000, pool);

    expect(shops.map((s) => s.name)).toEqual(['Near shop (0.5 km)', 'Just inside (1.9 km)']);
    expect(shops[0]?.distance_m).toBeGreaterThan(450);
    expect(shops[0]?.distance_m).toBeLessThan(550);
    expect(shops[1]?.distance_m).toBeGreaterThan(1800);
    expect(shops[1]?.distance_m).toBeLessThan(2000);
  });

  it('returns an empty list when no shop is in range', async () => {
    const shops = await findShopsWithinRadius(ORIGIN.lat, ORIGIN.lng, 100, pool);

    expect(shops).toEqual([]);
  });
});
