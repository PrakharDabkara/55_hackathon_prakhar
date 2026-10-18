import { planRoute } from '../routing/index.js';
import type { PlanItem, PlanVariant } from './plan.js';

/** What a customer may choose for each shop. */
export type DeliveryMode = 'pickup' | 'delivery';

/**
 * What the plans are ranked with when a shop offers delivery without naming a fee: a typical
 * neighbourhood fee. Only for comparing plans; the screen says the fee is not known.
 */
export const TYPICAL_DELIVERY_FEE_PAISE = 3000;

/** The parts of a plan that `applyModes` reads and rewrites. */
export type ModeVariant = Pick<
  PlanVariant,
  'kind' | 'route' | 'totalPricePaise' | 'totalDistanceM' | 'shopCount' | 'savingsPaise'
> & {
  items: (Pick<PlanItem, 'shopId' | 'shopName' | 'status' | 'delivery'> &
    Record<string, unknown>)[];
  unknownPriceCount?: number;
  comparablePricePaise?: number;
};

export type ModedVariant<V extends ModeVariant> = Omit<V, 'items'> & {
  items: (V['items'][number] & { mode: DeliveryMode })[];
  /** What the customer pays the shops that deliver, once per shop; unknown fees are not in it. */
  deliveryFeePaise: number;
  /** Shops that deliver without having said what it costs. */
  unknownFeeCount: number;
  /** Shops the customer chose delivery from. `shopCount` is the pickup stops left. */
  deliveryShopCount: number;
  /** Items plus the known fees: what the customer will pay. */
  grandTotalPaise: number;
  comparablePricePaise: number;
};

/**
 * Applies the customer's pickup or delivery choice for each shop to a plan (ADR-0031). Pure: the
 * stored plan is never changed; totals are recomputed here, never by the model.
 *  - A shop only goes to delivery if it offered it; otherwise it stays pickup.
 *  - Delivery counts as 0 on the route: that shop leaves the stops, the route is planned again
 *    over the rest, and `shopCount` and the distance follow.
 *  - One fee per shop, however many items come from it. If its answers named different fees, the
 *    largest is used. A fee nobody named is unknown, never ₹0.
 */
export function applyModes<V extends ModeVariant>(
  variant: V,
  origin: { lat: number; lng: number },
  modes: Record<string, DeliveryMode>,
): ModedVariant<V> {
  const offers = new Map<string, { feePaise: number | null }>();
  for (const item of variant.items) {
    if (!item.delivery || !item.shopId) continue;
    const have = offers.get(item.shopId);
    const fee = item.delivery.feePaise;
    // The largest named fee; a named fee beats an unnamed one only if some item named it.
    const merged =
      have === undefined
        ? fee
        : have.feePaise === null
          ? fee
          : fee === null
            ? have.feePaise
            : Math.max(have.feePaise, fee);
    offers.set(item.shopId, { feePaise: merged });
  }
  const delivered = new Set([...offers.keys()].filter((shopId) => modes[shopId] === 'delivery'));

  let deliveryFeePaise = 0;
  let unknownFeeCount = 0;
  for (const shopId of delivered) {
    const fee = offers.get(shopId)?.feePaise ?? null;
    if (fee === null) unknownFeeCount++;
    else deliveryFeePaise += fee;
  }

  const items = variant.items.map((item) => ({
    ...item,
    mode: (item.shopId && delivered.has(item.shopId) ? 'delivery' : 'pickup') as DeliveryMode,
  }));

  let route = variant.route;
  let totalDistanceM = variant.totalDistanceM;
  let shopCount = variant.shopCount;
  if (delivered.size > 0 && variant.route) {
    const stops = variant.route.orderedStops.filter((s) => !delivered.has(s.shopId));
    shopCount = stops.length;
    if (stops.length === 0) {
      route = null;
      totalDistanceM = 0;
    } else {
      const best = planRoute(origin, stops);
      const legsM = best.legsM.map(Math.round);
      totalDistanceM = legsM.reduce((a, b) => a + b, 0);
      route = { orderedStops: best.orderedStops, legsM, totalM: totalDistanceM };
    }
  }

  const base = variant.comparablePricePaise ?? variant.totalPricePaise;
  return {
    ...variant,
    items,
    route,
    totalDistanceM,
    shopCount,
    deliveryFeePaise,
    unknownFeeCount,
    deliveryShopCount: delivered.size,
    grandTotalPaise: variant.totalPricePaise + deliveryFeePaise,
    // Ranked with a typical fee where a shop did not say.
    comparablePricePaise: base + deliveryFeePaise + unknownFeeCount * TYPICAL_DELIVERY_FEE_PAISE,
  };
}
