import type { Pool } from 'pg';

// A point in Indore (Rajwada). One degree of latitude is ~111 km.
export const ORIGIN = { lat: 22.7196, lng: 75.8577 };
export const north = (km: number) => ORIGIN.lat + km / 111;

/** A shop `km` north of ORIGIN that learned it has the item `ageHours` ago. */
export async function insertShopWithStock(
  pool: Pool,
  opts: { name: string; km: number; itemId: string; ageHours: number },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO shops (name, phone, categories, location)
     VALUES ($1, '+910000000000', ARRAY['grocery'],
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) RETURNING id`,
    [opts.name, ORIGIN.lng, north(opts.km)],
  );
  const shopId = (rows[0] as { id: string }).id;
  await pool.query(
    `INSERT INTO shop_stock (shop_id, item_id, source, last_confirmed_at, expires_at)
     VALUES ($1, $2, 'ping_yes', now() - make_interval(hours => $3::int),
             now() - make_interval(hours => $3::int) + interval '7 days')`,
    [shopId, opts.itemId, opts.ageHours],
  );
  return shopId;
}
