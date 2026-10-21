import { planRoute, type Point } from '../routing/index.js';

export interface CoverShop extends Point {
  shopId: string;
  /** The lines this shop said it has (list position), with its price in paise. */
  have: ReadonlyMap<number, number>;
}

export interface CoverPlan {
  /** Each covered line goes to one shop: the cheapest one in the chosen set. */
  assignments: { position: number; shopId: string; pricePaise: number }[];
  /** The chosen shops in route order from the customer. */
  stops: string[];
  totalM: number;
  totalPaise: number;
  /** Lines no shop has ("nobody has this yet"). */
  missing: number[];
}

const EMPTY: CoverPlan = { assignments: [], stops: [], totalM: 0, totalPaise: 0, missing: [] };

/** Each line to the cheapest shop of the set (a tie goes to the earlier shop in the list). */
function assign(shops: readonly CoverShop[], positions: readonly number[]) {
  const assignments: CoverPlan['assignments'] = [];
  for (const position of positions) {
    let best: { shopId: string; pricePaise: number } | null = null;
    for (const s of shops) {
      const price = s.have.get(position);
      if (price !== undefined && (best === null || price < best.pricePaise))
        best = { shopId: s.shopId, pricePaise: price };
    }
    if (best) assignments.push({ position, ...best });
  }
  return assignments;
}

/**
 * The default plan (ADR-0055 rule 10), exact. Of the shops given (at most 8: 255 subsets) take the
 * fewest that together have every line that any of them has; among sets of that size the shortest
 * route from `origin` (the errand's `planRoute`), then the lower total price, then the lower shop
 * ids. Lines nobody has are `missing`.
 */
export function bestCover(
  origin: Point,
  shops: readonly CoverShop[],
  positions: readonly number[],
): CoverPlan {
  const coverable = positions.filter((p) => shops.some((s) => s.have.has(p)));
  const missing = positions.filter((p) => !coverable.includes(p));
  if (coverable.length === 0) return { ...EMPTY, missing: [...missing] };

  // Every subset that has all the coverable lines, by size.
  const covering: number[][] = [];
  for (let mask = 1; mask < 1 << shops.length; mask++) {
    const members = shops.flatMap((_, i) => (mask & (1 << i) ? [i] : []));
    if (coverable.every((p) => members.some((i) => (shops[i] as CoverShop).have.has(p))))
      covering.push(members);
  }
  const smallest = Math.min(...covering.map((m) => m.length));

  let best: { plan: CoverPlan; key: string } | null = null;
  for (const members of covering) {
    if (members.length !== smallest) continue;
    const set = members.map((i) => shops[i] as CoverShop);
    const route = planRoute(
      origin,
      set.map((s) => ({ shopId: s.shopId, label: s.shopId, lat: s.lat, lng: s.lng })),
    );
    const assignments = assign(set, coverable);
    const plan: CoverPlan = {
      assignments,
      stops: route.orderedStops.map((s) => s.shopId),
      totalM: route.totalM,
      totalPaise: assignments.reduce((sum, a) => sum + a.pricePaise, 0),
      missing: [...missing],
    };
    const key = [...set.map((s) => s.shopId)].sort().join('|');
    if (
      best === null ||
      plan.totalM < best.plan.totalM - 1e-6 ||
      (Math.abs(plan.totalM - best.plan.totalM) <= 1e-6 &&
        (plan.totalPaise < best.plan.totalPaise ||
          (plan.totalPaise === best.plan.totalPaise && key < best.key)))
    )
      best = { plan, key };
  }
  return (best as { plan: CoverPlan }).plan;
}
