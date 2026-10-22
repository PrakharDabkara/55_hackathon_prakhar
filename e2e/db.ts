import { Redis } from 'ioredis';
import pg from 'pg';

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  try {
    // CI and a developer's machine both have a .env; the API reads the same one.
    process.loadEnvFile('.env');
  } catch {
    // Not there: DATABASE_URL may already be in the environment.
  }
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Makes every yes a shop gave look an hour old. An order from an old yes is a request the shop has
 * to accept (ADR-0039); a fresh yes starts ACCEPTED. The only way to get one without waiting.
 */
export async function ageAnswers(shopName: string) {
  await withDb((client) =>
    client.query(
      `UPDATE pings SET answered_at = answered_at - interval '1 hour'
        WHERE state = 'YES' AND shop_id IN (SELECT id FROM shops WHERE name = $1)`,
      [shopName],
    ),
  );
}

/** The demo place in Indore, where the simulated shops stand. */
const DEMO = { latitude: 22.7196, longitude: 75.8577 };

/**
 * Makes the shops around the demo place forget what they learned and who asked them, so that the
 * next search for an item starts from a clean slate. A spec that asks at the demo place leaves two
 * traces for the simulated shops, which every spec of a run shares: learned stock (enough fresh
 * stock answers a search from memory) and the ping dedupe claim in Redis (a shop asked about an
 * item lately is not asked again). Either one makes the next search send no ping at all. Only
 * those two go: shops, pings and requests stay.
 */
export async function forgetDemoStock() {
  const shopIds = await withDb(async (client) => {
    const near = `SELECT id FROM shops
           WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, 5000)`;
    const params = [DEMO.latitude, DEMO.longitude];
    await client.query(`DELETE FROM shop_stock WHERE shop_id IN (${near})`, params);
    return (await client.query<{ id: string }>(near, params)).rows.map((r) => r.id);
  });
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
  });
  try {
    const near = new Set(shopIds);
    // A key is `ping-dedupe-<shop id>-<item id>`; a uuid has no spare dashes to confuse the split.
    const keys = (await redis.keys('ping-dedupe-*')).filter((k) => near.has(k.slice(12, 48)));
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
