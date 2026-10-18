import type { Category } from '@kahanmilega/shared';
import type { Queryable } from '../../db/queryable.js';

export interface Shop {
  id: string;
  name: string;
  phone: string;
  lat: number;
  lng: number;
  categories: Category[];
  /** False while the owner has closed the shop for the day (ADR-0031). */
  open: boolean;
  closedUntil: Date | null;
  /** The standing "ghar bhej denge" offer, so a yes is one tap. */
  deliversDefault: boolean;
  defaultFeePaise: number | null;
  defaultMinutes: number | null;
}

/** A delivery offer: both parts optional. */
export interface DeliveryDefaults {
  feePaise?: number | undefined;
  minutes?: number | undefined;
}

export interface NewShop {
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
  delivery?: DeliveryDefaults | undefined;
}

export interface ShopChanges {
  name?: string;
  location?: { lat: number; lng: number };
  categories?: Category[];
  /** A delivery offer, or null to stop offering it. */
  delivery?: DeliveryDefaults | null;
}

const COLUMNS = `id, name, phone, categories,
  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
  (closed_until IS NULL OR closed_until <= now()) AS open,
  CASE WHEN closed_until > now() THEN closed_until END AS "closedUntil",
  delivers_default AS "deliversDefault", default_fee_paise AS "defaultFeePaise",
  default_minutes AS "defaultMinutes"`;

/** Creates the owner's shop, or returns null if they already have one. */
export async function createShop(
  db: Queryable,
  owner: { id: string; phone: string },
  shop: NewShop,
): Promise<Shop | null> {
  // PostGIS points are (x = longitude, y = latitude): lng comes first.
  const { rows } = await db.query<Shop>(
    `INSERT INTO shops (owner_user_id, name, phone, categories, location,
                        delivers_default, default_fee_paise, default_minutes)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, $9)
     ON CONFLICT (owner_user_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      owner.id,
      shop.name,
      owner.phone,
      shop.categories,
      shop.lng,
      shop.lat,
      Boolean(shop.delivery),
      shop.delivery?.feePaise ?? null,
      shop.delivery?.minutes ?? null,
    ],
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
        location   = COALESCE(ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, location),
        delivers_default = CASE WHEN $6::boolean THEN $7::boolean ELSE delivers_default END,
        default_fee_paise = CASE WHEN $6::boolean THEN $8::integer ELSE default_fee_paise END,
        default_minutes = CASE WHEN $6::boolean THEN $9::integer ELSE default_minutes END
      WHERE owner_user_id = $1
      RETURNING ${COLUMNS}`,
    [
      ownerId,
      changes.name ?? null,
      changes.categories ?? null,
      changes.location?.lng ?? null,
      changes.location?.lat ?? null,
      changes.delivery !== undefined,
      Boolean(changes.delivery),
      changes.delivery?.feePaise ?? null,
      changes.delivery?.minutes ?? null,
    ],
  );
  return rows[0] ?? null;
}

/** The end of today in India (Asia/Kolkata): when a shop closed "for today" opens by itself. */
const END_OF_TODAY = `((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day') AT TIME ZONE 'Asia/Kolkata')`;

/** Opens or closes the owner's shop. Closing lasts until the end of the day. */
export async function setShopOpen(
  db: Queryable,
  ownerId: string,
  open: boolean,
): Promise<Shop | null> {
  const { rows } = await db.query<Shop>(
    `UPDATE shops SET closed_until = ${open ? 'NULL' : END_OF_TODAY}
      WHERE owner_user_id = $1 RETURNING ${COLUMNS}`,
    [ownerId],
  );
  return rows[0] ?? null;
}

export interface SimulatedShop extends NewShop {
  ownerUserId: string;
  phone: string;
}

/** Inserts simulated shops (is_simulated) in one statement; returns their ids in the input order. */
export async function insertSimulatedShops(
  db: Queryable,
  shops: SimulatedShop[],
): Promise<string[]> {
  const { rows } = await db.query<{ id: string; owner_user_id: string }>(
    `INSERT INTO shops (owner_user_id, name, phone, categories, location, is_simulated)
     SELECT o, n, p, string_to_array(c, ','),
            ST_SetSRID(ST_MakePoint(x, y), 4326)::geography, true
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::float8[])
            AS t(o, n, p, c, x, y)
     RETURNING id, owner_user_id`,
    [
      shops.map((s) => s.ownerUserId),
      shops.map((s) => s.name),
      shops.map((s) => s.phone),
      shops.map((s) => s.categories.join(',')),
      shops.map((s) => s.lng),
      shops.map((s) => s.lat),
    ],
  );
  const idByOwner = new Map(rows.map((r) => [r.owner_user_id, r.id]));
  return shops.map((s) => idByOwner.get(s.ownerUserId) as string);
}

/**
 * Deletes every simulated shop; its pings and stock go with it (ON DELETE CASCADE). Returns the
 * owner user ids so the caller can delete the users too.
 */
export async function deleteSimulatedShops(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ owner_user_id: string | null }>(
    `DELETE FROM shops WHERE is_simulated RETURNING owner_user_id`,
  );
  return rows.flatMap((r) => (r.owner_user_id ? [r.owner_user_id] : []));
}
