export interface Candidate {
  shopId: string;
  categories: string[];
  distanceM: number;
}

interface Options {
  itemCategory: string;
  radiusM: number;
  /** Shops that already have the item in learned stock: no need to ask them. */
  excludeShopIds: ReadonlySet<string>;
  max: number;
}

/**
 * Who to ping: shops inside the radius that sell this kind of item and are not already known to
 * have it, nearest first, at most `max`. Returns a new array.
 */
export function selectPingTargets<T extends Candidate>(candidates: T[], opts: Options): T[] {
  return candidates
    .filter(
      (c) =>
        c.distanceM <= opts.radiusM &&
        c.categories.includes(opts.itemCategory) &&
        !opts.excludeShopIds.has(c.shopId),
    )
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, opts.max);
}
