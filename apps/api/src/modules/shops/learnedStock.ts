import type { Queryable } from '../../db/queryable.js';
import {
  freshnessLabel,
  rankResults,
  type LearnedStockResult,
  type QuantityHint,
} from './stock.js';

interface Row {
  shop_id: string;
  name: string;
  distance_m: number;
  price_paise: number | null;
  quantity_hint: QuantityHint | null;
  last_confirmed_at: Date;
}

/**
 * Shops within `radiusM` whose learned stock has the item and has not expired, freshest bucket
 * first, then nearest. One query: the join and the distance filter both run in Postgres.
 */
export async function findLearnedStock(
  db: Queryable,
  itemId: string,
  lat: number,
  lng: number,
  radiusM: number,
  now: Date = new Date(),
): Promise<LearnedStockResult[]> {
  // PostGIS points are (x = longitude, y = latitude): lng comes first.
  const { rows } = await db.query<Row>(
    `WITH origin AS (SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography AS point)
     SELECT s.id AS shop_id, s.name, ST_Distance(s.location, origin.point) AS distance_m,
            st.price_paise, st.quantity_hint, st.last_confirmed_at
       FROM shop_stock st
       JOIN shops s ON s.id = st.shop_id, origin
      WHERE st.item_id = $1
        AND st.expires_at > $5
        AND ST_DWithin(s.location, origin.point, $4)`,
    [itemId, lng, lat, radiusM, now],
  );
  return rankResults(
    rows.map((r) => ({
      shopId: r.shop_id,
      name: r.name,
      distanceM: Math.round(r.distance_m),
      pricePaise: r.price_paise,
      quantityHint: r.quantity_hint,
      lastConfirmedAt: r.last_confirmed_at,
      freshness: freshnessLabel(r.last_confirmed_at, now),
    })),
    now,
  );
}
