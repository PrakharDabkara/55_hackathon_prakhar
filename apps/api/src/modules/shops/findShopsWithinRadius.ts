import type { Queryable } from '../../db/queryable.js';

export interface ShopWithDistance {
  id: string;
  name: string;
  phone: string;
  categories: string[];
  distance_m: number;
}

/** Shops within `meters` of the point, nearest first. */
export async function findShopsWithinRadius(
  lat: number,
  lng: number,
  meters: number,
  db: Queryable,
): Promise<ShopWithDistance[]> {
  // PostGIS points are (x = longitude, y = latitude): lng comes first.
  const { rows } = await db.query<ShopWithDistance>(
    `WITH origin AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS point)
     SELECT s.id, s.name, s.phone, s.categories,
            ST_Distance(s.location, origin.point) AS distance_m
       FROM shops s, origin
      WHERE ST_DWithin(s.location, origin.point, $3)
      ORDER BY distance_m`,
    [lng, lat, meters],
  );
  return rows;
}
