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
  /** A misc request (ADR-0046): every open shop in the radius counts, whatever it sells. */
  anyCategory?: boolean;
}

/**
 * Who to ping: shops inside the radius that sell this kind of item (any of the item's categories) and are not already known to
 * have it, nearest first, at most `max`. If fewer than `minTargets` match, the nearest of the
 * other shops are added (ADR-0028). Returns a new array.
 */
export function selectPingTargets<T extends Candidate>(candidates: T[], opts: Options): T[] {
  const byDistance = (a: T, b: T) => a.distanceM - b.distanceM;
  const inRadius = candidates.filter((c) => c.distanceM <= opts.radiusM);
  const ofKind = inRadius.filter(
    (c) =>
      opts.anyCategory === true ||
      c.categories.some((category) => opts.itemCategories.includes(category)),
  );
  const matching = ofKind
    .filter((c) => !opts.excludeShopIds.has(c.shopId))
    .sort(byDistance)
    .slice(0, opts.max);
  // "Too few" counts every nearby shop of the kind, also those already known to have the item:
  // a street with plenty of such shops needs no help from the other kinds.
  const missing = Math.min(opts.minTargets ?? 0, opts.max) - ofKind.length;
  if (missing <= 0) return matching;
  const others = inRadius
    .filter((c) => !ofKind.includes(c) && !opts.excludeShopIds.has(c.shopId))
    .sort(byDistance)
    .slice(0, missing);
  return [...matching, ...others];
}
