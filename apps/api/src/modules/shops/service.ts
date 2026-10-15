import type { Category } from '@kahanmilega/shared';
import type { Queryable } from '../../db/queryable.js';

export interface Shop {
  id: string;
  name: string;
  phone: string;
  lat: number;
  lng: number;
  categories: Category[];
}

export interface NewShop {
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
}

export interface ShopChanges {
  name?: string;
  location?: { lat: number; lng: number };
  categories?: Category[];
}

const COLUMNS = `id, name, phone, categories,
  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`;

/** Creates the owner's shop, or returns null if they already have one. */
export async function createShop(
  db: Queryable,
  owner: { id: string; phone: string },
  shop: NewShop,
): Promise<Shop | null> {
  // PostGIS points are (x = longitude, y = latitude): lng comes first.
  const { rows } = await db.query<Shop>(
    `INSERT INTO shops (owner_user_id, name, phone, categories, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)
     ON CONFLICT (owner_user_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [owner.id, shop.name, owner.phone, shop.categories, shop.lng, shop.lat],
  );
  return rows[0] ?? null;
}

export async function findShopByOwner(db: Queryable, ownerId: string): Promise<Shop | null> {
  const { rows } = await db.query<Shop>(`SELECT ${COLUMNS} FROM shops WHERE owner_user_id = $1`, [
    ownerId,
  ]);
  return rows[0] ?? null;
}

/** Applies only the given fields; null if the owner has no shop. */
export async function updateShopByOwner(
  db: Queryable,
  ownerId: string,
  changes: ShopChanges,
): Promise<Shop | null> {
  const { rows } = await db.query<Shop>(
    `UPDATE shops SET
        name       = COALESCE($2, name),
        categories = COALESCE($3, categories),
        location   = COALESCE(ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, location)
      WHERE owner_user_id = $1
      RETURNING ${COLUMNS}`,
    [
      ownerId,
      changes.name ?? null,
      changes.categories ?? null,
      changes.location?.lng ?? null,
      changes.location?.lat ?? null,
    ],
  );
  return rows[0] ?? null;
}
