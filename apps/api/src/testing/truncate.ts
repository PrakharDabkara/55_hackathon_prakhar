import type { Pool } from 'pg';

/**
 * `TRUNCATE <tables> CASCADE` for tests, without emptying `shops`. A shop points at its logo
 * (shops.logo_photo_id, ADR-0040), and photos point at requests and errands, so a plain cascade
 * from requests or errands would reach shops and everything that hangs on them. The link is
 * dropped for the truncate and put back, with no logo left, in one transaction.
 */
export async function truncateKeepingShops(pool: Pick<Pool, 'connect'>, tables: string) {
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
