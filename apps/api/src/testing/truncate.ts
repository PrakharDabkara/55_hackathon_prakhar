import type { Pool } from 'pg';

const ATTEMPTS = 3;
const BACKOFF_MS = 100;
const DEADLOCK = '40P01';

/**
 * `TRUNCATE <tables> CASCADE` for tests, without emptying `shops`. A shop points at its logo
 * (shops.logo_photo_id, ADR-0040), and photos point at requests and errands, so a plain cascade
 * from requests or errands would reach shops and everything that hangs on them. The link is
 * dropped for the truncate and put back, with no logo left, in one transaction.
 *
 * Postgres ends a deadlock by cancelling one of the two transactions. When that is this one (a
 * query from the last test was still running), it is tried again, at most twice and with a
 * warning, so a deadlock that keeps coming back still fails.
 */
export async function truncateKeepingShops(pool: Pick<Pool, 'connect'>, tables: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await truncateOnce(pool, tables);
    } catch (error) {
      if ((error as { code?: string }).code !== DEADLOCK || attempt >= ATTEMPTS) throw error;
      console.warn(`truncateKeepingShops: deadlock (40P01), attempt ${attempt} of ${ATTEMPTS}`);
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
    }
  }
}

async function truncateOnce(pool: Pick<Pool, 'connect'>, tables: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE shops DROP CONSTRAINT shops_logo_photo_id_fkey');
    await client.query(`TRUNCATE ${tables} CASCADE`);
    await client.query('UPDATE shops SET logo_photo_id = NULL');
    await client.query(
      `ALTER TABLE shops ADD CONSTRAINT shops_logo_photo_id_fkey
         FOREIGN KEY (logo_photo_id) REFERENCES photos (id) ON DELETE SET NULL`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
