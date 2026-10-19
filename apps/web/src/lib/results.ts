import type { Pin } from '../components/ResultsMap.js';
import type { SeekerRequest, ShopResult } from './seekerApi.js';

export type SortKey = 'price' | 'distance';

/** A sorted copy. Shops that gave no price go last when sorting by price. */
export function sortResults(results: ShopResult[], by: SortKey): ShopResult[] {
  const price = (r: ShopResult) => r.pricePaise ?? Number.POSITIVE_INFINITY;
  const compare =
    by === 'price'
      ? (a: ShopResult, b: ShopResult) => price(a) - price(b) || a.distanceM - b.distanceM
      : (a: ShopResult, b: ShopResult) => a.distanceM - b.distanceM;
  return [...results].sort(compare);
}

/** One map pin per shop: green for a live answer, blue for remembered stock. */
export function pinsFor(results: ShopResult[]): Pin[] {
  return results.map((r) => ({
    id: r.shopId,
    lat: r.lat,
    lng: r.lng,
    kind: r.source === 'live' ? 'live' : 'learned',
    label: r.name,
  }));
}

export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

const priceKey = (r: ShopResult) => r.pricePaise ?? Number.POSITIVE_INFINITY;

/** Shops that said yes to this request: cheapest first (no price last), then nearest. */
export function liveReplies(results: ShopResult[]): ShopResult[] {
  return results
    .filter((r) => r.source === 'live')
    .sort((a, b) => priceKey(a) - priceKey(b) || a.distanceM - b.distanceM);
}

/** Remembered stock, not checked for this request: the most recently confirmed first. */
export function learnedReplies(results: ShopResult[]): ShopResult[] {
  return results
    .filter((r) => r.source === 'learned')
    .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
}

/**
 * The shop that is cheapest by a clear margin among live answers. Needs two priced answers to
 * compare, and nobody wins a tie: then there is no "best price" to claim.
 */
export function bestPriceShopId(live: ShopResult[]): string | null {
  const priced = live.filter((r) => r.pricePaise !== null);
  const [first, second] = priced;
  if (!first || !second) return null;
  return (first.pricePaise as number) < (second.pricePaise as number) ? first.shopId : null;
}

/** Whole days since `iso`: 0 is today (or a clock that is a little behind). */
export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** The item's name on screen: Hindi on a Hindi screen, else English; null when there is no item. */
export function itemLabel(item: SeekerRequest['item'], lang: 'hi' | 'en'): string | null {
  if (!item) return null;
  return lang === 'hi' ? item.nameHi : item.nameEn;
}
