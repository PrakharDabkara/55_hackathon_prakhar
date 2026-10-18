import { compareQuantity, type ExactQuantity } from '@kahanmilega/shared';
import {
  freshnessLabel,
  type DeliveryOffer,
  type LearnedStockResult,
  type QuantityHint,
} from '../shops/index.js';

export type SortKey = 'distance' | 'price';

/** A shop that said yes to this very request. */
export interface LiveAnswer {
  shopId: string;
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
  pricePaise: number | null;
  quantityHint: QuantityHint | null;
  answeredAt: Date;
  /** The shop's photo of the item with its yes, if it added one. */
  photoId?: string | null;
  quantity?: ExactQuantity | null;
  delivery?: DeliveryOffer | null;
}

export interface RequestResult {
  shopId: string;
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
  pricePaise: number | null;
  quantityHint: QuantityHint | null;
  lastConfirmedAt: Date;
  freshness: string;
  /** `live`: said yes to this request. `learned`: remembered from an earlier yes. */
  source: 'live' | 'learned';
  /** Target minus price, only when the price is below the target. */
  savingsPaise?: number;
  /** The shop's photo of the item (live answers only). */
  photoId?: string;
  /** The exact quantity the shop said (live), or last said (learned: remembered, never a promise). */
  quantity?: ExactQuantity;
  /** Is it enough for what the customer typed ("2 kg")? Live answers only. */
  quantityCheck?: 'enough' | 'short' | 'unknown';
  /** "Ghar bhej denge": what the shop offered, with its yes or last time. */
  delivery?: DeliveryOffer;
}

export function liveLabel(answeredAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - answeredAt.getTime()) / 60_000));
  if (minutes < 1) return 'Confirmed just now';
  if (minutes < 60) return `Confirmed ${minutes} min ago`;
  if (minutes < 24 * 60) return `Confirmed ${Math.floor(minutes / 60)} h ago`;
  return freshnessLabel(answeredAt, now);
}

interface Input {
  live: LiveAnswer[];
  learned: LearnedStockResult[];
  targetPricePaise: number | null;
  /** Default: price when a target price is set, else distance. */
  sort: SortKey | undefined;
  now: Date;
  /** What the customer typed ("2 kg"), to check a shop's exact quantity against. */
  askedQuantity?: ExactQuantity | null;
}

/** Live answers plus learned stock, one row per shop (live wins), sorted, with savings. */
export function buildResults({
  live,
  learned,
  targetPricePaise,
  sort,
  now,
  askedQuantity = null,
}: Input): RequestResult[] {
  const rows = new Map<string, RequestResult>();

  for (const { quantity, delivery, ...l } of learned)
    rows.set(l.shopId, {
      ...l,
      source: 'learned',
      ...(quantity && { quantity }),
      ...(delivery && { delivery }),
    });
  for (const a of live) {
    rows.set(a.shopId, {
      shopId: a.shopId,
      name: a.name,
      distanceM: a.distanceM,
      lat: a.lat,
      lng: a.lng,
      pricePaise: a.pricePaise,
      quantityHint: a.quantityHint,
      lastConfirmedAt: a.answeredAt,
      freshness: liveLabel(a.answeredAt, now),
      source: 'live',
      ...(a.photoId && { photoId: a.photoId }),
      ...(a.quantity && {
        quantity: a.quantity,
        ...(askedQuantity && { quantityCheck: compareQuantity(askedQuantity, a.quantity) }),
      }),
      ...(a.delivery && { delivery: a.delivery }),
    });
  }

  const results = [...rows.values()].map((r) =>
    targetPricePaise !== null && r.pricePaise !== null && r.pricePaise < targetPricePaise
      ? { ...r, savingsPaise: targetPricePaise - r.pricePaise }
      : r,
  );

  const key = sort ?? (targetPricePaise !== null ? 'price' : 'distance');
  const byDistance = (a: RequestResult, b: RequestResult) => a.distanceM - b.distanceM;
  // Unknown prices sort after known ones.
  const price = (r: RequestResult) => r.pricePaise ?? Number.POSITIVE_INFINITY;
  return results.sort(
    key === 'price' ? (a, b) => price(a) - price(b) || byDistance(a, b) : byDistance,
  );
}
