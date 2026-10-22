import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, 'apps/api/migrations');
const DEMOTE = 29; // 029_demote_admins.sql

describe('migration 029: no phone is an admin any more (ADR-0058)', () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;

  const migrate = (count: number) =>
    runner({
      databaseUrl: container.getConnectionUri(),
      dir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count,
      log: () => {},
    });

  beforeAll(async () => {
    await GenericContainer.fromDockerfile(path.join(root, 'infra/postgres')).build(
      'askbuy-postgres:test',
      { deleteOnExit: false },
    );
    container = await new PostgreSqlContainer('askbuy-postgres:test').start();
    await migrate(DEMOTE - 1);
    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    // The state of a database that ran the ADMIN_PHONES login: an admin with a live session, other
    // users, and readable codes in the demo inbox. Obviously fake numbers.
    await client.query(
      `INSERT INTO users (id, phone, role) VALUES
         ('00000000-0000-0000-0000-0000000000a1', '+919000000101', 'admin'),
         ('00000000-0000-0000-0000-0000000000a2', '+919000000102', 'seeker'),
         ('00000000-0000-0000-0000-0000000000a3', '+919000000103', 'shop')`,
    );
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       SELECT repeat(right(u.id::text, 1), 64), u.id, now() + interval '30 days' FROM users u`,
    );
    await client.query(
      `INSERT INTO otp_codes (phone, code_hash, dev_code, expires_at)
       VALUES ('+919000000104', repeat('b', 64), '123456', now() + interval '5 minutes')`,
    );
    await migrate(Infinity);
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  const roleOf = async (id: string) =>
    (await client.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [id])).rows[0]
      ?.role;

  it('turns every admin user into a seeker, and leaves the others alone', async () => {
    expect(await roleOf('00000000-0000-0000-0000-0000000000a1')).toBe('seeker');
    expect(await roleOf('00000000-0000-0000-0000-0000000000a2')).toBe('seeker');
    expect(await roleOf('00000000-0000-0000-0000-0000000000a3')).toBe('shop');
  });

  it('ends the sessions of the former admin only', async () => {
    const { rows } = await client.query<{ user_id: string }>('SELECT user_id FROM sessions');
    const owners = rows.map((r) => r.user_id).sort();
    expect(owners).toEqual([
      '00000000-0000-0000-0000-0000000000a2',
      '00000000-0000-0000-0000-0000000000a3',
    ]);
  });

  it('wipes the readable codes of the demo inbox but keeps the hashes', async () => {
    const { rows } = await client.query('SELECT dev_code, code_hash FROM otp_codes');
    expect(rows).toHaveLength(1);
    expect(rows[0].dev_code).toBeNull();
    expect(rows[0].code_hash).toBe('b'.repeat(64));
  });

  it('makes an admin row impossible from now on', async () => {
    await expect(
      client.query(`INSERT INTO users (phone, role) VALUES ('+919000000105', 'admin')`),
    ).rejects.toThrow(/users_role_check/);
    await expect(
      client.query(`UPDATE users SET role = 'admin' WHERE phone = '+919000000102'`),
    ).rejects.toThrow(/users_role_check/);
  });
});
