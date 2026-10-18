export interface Candidate {
  shopId: string;
  categories: string[];
  distanceM: number;
}

interface Options {
  /** Every kind of shop that carries the item: a shop with any one of them is a target. */
  itemCategories: readonly string[];
  radiusM: number;
  /** Shops that already have the item in learned stock: no need to ask them. */
  excludeShopIds: ReadonlySet<string>;
  max: number;
  /**
   * Fewest shops worth pinging. When fewer shops match the category, the nearest shops of any
   * category fill the gap up to this number (still within the radius and the cap).
   */
  minTargets?: number;
}

/**
 * Who to ping: shops inside the radius that sell this kind of item (any of the item's categories) and are not already known to
 * have it, nearest first, at most `max`. If fewer than `minTargets` match, the nearest of the
 * other shops are added (ADR-0028). Returns a new array.
 */
export function selectPingTargets<T extends Candidate>(candidates: T[], opts: Options): T[] {
  const byDistance = (a: T, b: T) => a.distanceM - b.distanceM;
  const eligible = candidates.filter(
    (c) => c.distanceM <= opts.radiusM && !opts.excludeShopIds.has(c.shopId),
  );
  const matching = eligible
    .filter((c) => c.categories.some((category) => opts.itemCategories.includes(category)))
    .sort(byDistance)
    .slice(0, opts.max);
  const wanted = Math.min(opts.minTargets ?? 0, opts.max);
  if (matching.length >= wanted) return matching;
  const others = eligible
    .filter((c) => !matching.includes(c))
    .sort(byDistance)
    .slice(0, wanted - matching.length);
  return [...matching, ...others];
}
