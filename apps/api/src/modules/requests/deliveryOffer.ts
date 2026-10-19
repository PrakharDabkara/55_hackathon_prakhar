import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { getItem } from '../catalog/index.js';
import { findLearnedStock } from '../shops/index.js';
import { findRequest } from './persistence.js';

/** What an order needs from a request: the shop's line and its delivery offer. */
export interface RequestDeliveryOffer {
  lat: number;
  lng: number;
  lines: {
    name: string;
    nameHi?: string;
    text?: string;
    count: number;
    pricePaise: number | null;
  }[];
  feePaise: number | null;
  minutes: number | null;
}

/**
 * What a shop offered for delivery on this request (ADR-0031): its own yes, or else what it last
 * told us (learned stock, still fresh). 404 for an unknown or someone else's request; 409 when the
 * shop did not offer delivery. Price and fee come from the shop's answer, never from the client.
 */
export async function deliveryOfferForRequest(
  db: Queryable,
  userId: string,
  requestId: string,
  shopId: string,
): Promise<RequestDeliveryOffer> {
  const request = await findRequest(db, requestId);
  if (!request || request.userId !== userId)
    throw new ApiError(404, 'not_found', 'No such request');
  const item = await getItem(db, request.itemId);
  const { rows } = await db.query<{
    price_paise: number | null;
    delivery_fee_paise: number | null;
    delivery_minutes: number | null;
  }>(
    `SELECT price_paise, delivery_fee_paise, delivery_minutes FROM pings
      WHERE request_id = $1 AND shop_id = $2 AND state = 'YES' AND delivers
      ORDER BY answered_at DESC LIMIT 1`,
    [requestId, shopId],
  );
  let offer: { pricePaise: number | null; feePaise: number | null; minutes: number | null } | null =
    rows[0]
      ? {
          pricePaise: rows[0].price_paise,
          feePaise: rows[0].delivery_fee_paise,
          minutes: rows[0].delivery_minutes,
        }
      : null;
  if (!offer) {
    const learned = (
      await findLearnedStock(db, request.itemId, request.lat, request.lng, request.radiusM)
    ).find((s) => s.shopId === shopId && s.delivery);
    if (learned?.delivery)
      offer = {
        pricePaise: learned.pricePaise,
        feePaise: learned.delivery.feePaise,
        minutes: learned.delivery.minutes,
      };
  }
  if (!offer) throw new ApiError(409, 'no_delivery_offer', 'That shop did not offer delivery');
  const asked = request.quantity;
  const name = item?.nameEn ?? request.rawQuery;
  return {
    lat: request.lat,
    lng: request.lng,
    lines: [
      {
        name: asked ? `${name} (${asked.quantity} ${asked.unit})` : name,
        ...(item && { nameHi: item.nameHi }),
        text: request.rawQuery,
        count: 1,
        pricePaise: offer.pricePaise,
      },
    ],
    feePaise: offer.feePaise,
    minutes: offer.minutes,
  };
}
