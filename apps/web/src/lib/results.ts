import type { Pin } from '../components/ResultsMap.js';
import type { ShopResult } from './seekerApi.js';

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
