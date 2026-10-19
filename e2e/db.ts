import pg from 'pg';

/**
 * Makes every yes a shop gave look an hour old. An order from an old yes is a request the shop has
 * to accept (ADR-0039); a fresh yes starts ACCEPTED. The only way to get one without waiting.
 */
export async function ageAnswers(shopName: string) {
  try {
    // CI and a developer's machine both have a .env; the API reads the same one.
    process.loadEnvFile('.env');
  } catch {
    // Not there: DATABASE_URL may already be in the environment.
  }
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  try {
    await client.query(
      `UPDATE pings SET answered_at = answered_at - interval '1 hour'
        WHERE state = 'YES' AND shop_id IN (SELECT id FROM shops WHERE name = $1)`,
      [shopName],
    );
  } finally {
    await client.end();
  }
}
