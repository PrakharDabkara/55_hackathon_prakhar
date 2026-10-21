import type { Queryable } from '../../db/queryable.js';
import type { ExactQuantity } from '@askbuy/shared';
import {
  DOUBTFUL_AFTER_REPORTS,
  freshnessLabel,
  rankResults,
  type LearnedStockResult,
  type QuantityHint,
} from './stock.js';

interface Row {
  shop_id: string;
  name: string;
  logo_url: string | null;
  distance_m: number;
  lat: number;
  lng: number;
  price_paise: number | null;
  quantity_hint: QuantityHint | null;
  qty_amount: number | null;
  qty_unit: ExactQuantity['unit'] | null;
  delivers: boolean;
  delivery_fee_paise: number | null;
  delivery_minutes: number | null;
  last_confirmed_at: Date;
  verified: boolean;
  wrong_reports: number;
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
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            st.price_paise, st.quantity_hint, st.last_confirmed_at,
            st.qty_amount::float8 AS qty_amount, st.qty_unit, st.delivers,
            st.delivery_fee_paise, st.delivery_minutes,
            st.customer_verified_at IS NOT NULL AS verified, st.wrong_reports,
            CASE WHEN s.logo_photo_id IS NOT NULL THEN '/photos/' || s.logo_photo_id END AS logo_url
       FROM shop_stock st
       JOIN shops s ON s.id = st.shop_id, origin
      WHERE st.item_id = $1
        AND st.expires_at > $5
        -- a shop that closed for the day is not a place to go until it opens again
        AND (s.closed_until IS NULL OR s.closed_until <= $5)
        AND ST_DWithin(s.location, origin.point, $4)`,
    [itemId, lng, lat, radiusM, now],
  );
  return rankResults(
    rows.map((r) => ({
      shopId: r.shop_id,
      name: r.name,
      logoUrl: r.logo_url,
      distanceM: Math.round(r.distance_m),
      lat: r.lat,
      lng: r.lng,
      pricePaise: r.price_paise,
      quantityHint: r.quantity_hint,
      quantity:
        r.qty_amount !== null && r.qty_unit !== null
          ? { amount: r.qty_amount, unit: r.qty_unit }
          : null,
      delivery: r.delivers ? { feePaise: r.delivery_fee_paise, minutes: r.delivery_minutes } : null,
      lastConfirmedAt: r.last_confirmed_at,
      freshness: freshnessLabel(r.last_confirmed_at, now),
      ...(r.verified && { customerVerified: true }),
      ...(r.wrong_reports >= DOUBTFUL_AFTER_REPORTS && { doubtful: true }),
    })),
    now,
  );
}
