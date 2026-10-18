import { planRoute, type Point, type RoutePlan } from '../routing/index.js';

/**
 * The plan optimiser (ADR-0025). Pure and deterministic: no database, no clock, no model. It takes
 * every offer an errand has seen and builds two plans, "sasta" (the least money) and "kam_dukaan"
 * (the fewest shops), so the model never does this arithmetic.
 */

export type OfferStatus = 'confirmed' | 'likely';
export type PlanKind = 'sasta' | 'kam_dukaan';

/** One shop's answer for one item: a yes in this errand ("confirmed") or fresh learned stock. */
export interface Offer {
  itemId: string;
  shopId: string;
  shopName: string;
  lat: number;
  lng: number;
  distanceM: number;
  pricePaise: number | null;
  status: OfferStatus;
  freshness: string | null;
  /** The shop's photo of the item, for a confirmed offer. */
  photoId?: string | null;
  /** What the shop said about delivery with its yes (ADR-0031): null when it did not offer it. */
  delivery?: { feePaise: number | null; minutes: number | null } | null;
  /** The exact quantity the shop said it has, if it said one. */
  offeredQuantity?: { amount: number; unit: string } | null;
}

/** One thing the customer wants. `key` tells two entries apart (the same item may appear twice). */
export interface Wanted {
  key: string;
  itemId: string;
  quantity: number;
  referencePricePaise: number | null;
}

export type Assignment = Offer & { key: string };

export interface OptimisedPlan {
  kind: PlanKind;
  /** The shop each found item is bought from. */
  assignments: Assignment[];
  /** Keys of items that no shop has. */
  notFound: string[];
  /** Keys of items dropped because the plan would need more than the 8 stops a route holds. */
  tooManyShops: string[];
  /** The shops to visit, in route order. */
  shopIds: string[];
  route: { orderedStops: RoutePlan['orderedStops']; legsM: number[]; totalM: number } | null;
  /** Sum of price × quantity over the assignments that have a price. Unknown prices are not in it. */
  totalPricePaise: number;
  /** Keys of the assignments whose shop gave no price: counted, never treated as ₹0. */
  unknownPriceKeys: string[];
  /**
   * `totalPricePaise` plus a fair estimate for each unknown price (the median other shops quoted
   * for that item, else the item's typical price, else nothing). Used to compare plans, never shown
   * as a price.
   */
  comparablePricePaise: number;
  /** The length of the route in metres (0 without one). */
  totalDistanceM: number;
  /** Sum of (reference − price) × quantity where both are known; negative if dearer. */
  savingsPaise: number;
}

const MAX_STOPS = 8;

/** Cheapest known price first, an unknown price last, then nearest, then shop id (a stable tie-break). */
function byPrice(a: Offer, b: Offer): number {
  const pa = a.pricePaise ?? Infinity;
  const pb = b.pricePaise ?? Infinity;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.distanceM - b.distanceM || a.shopId.localeCompare(b.shopId);
}

/**
 * The offers worth considering for one item. One per shop, a yes in this errand winning over
 * learned stock. Confirmed offers only if there are any, else likely ones. Offers with a price
 * only if there are any, else the ones without.
 */
export function usableOffers(offers: Offer[]): Offer[] {
  const perShop = new Map<string, Offer>();
  for (const o of offers) {
    const have = perShop.get(o.shopId);
    if (!have || (o.status === 'confirmed' && have.status === 'likely')) perShop.set(o.shopId, o);
    else if (o.status === have.status && byPrice(o, have) < 0) perShop.set(o.shopId, o);
  }
  let list = [...perShop.values()];
  if (list.some((o) => o.status === 'confirmed'))
    list = list.filter((o) => o.status === 'confirmed');
  if (list.some((o) => o.pricePaise !== null)) list = list.filter((o) => o.pricePaise !== null);
  return list.sort(byPrice);
}

type Candidates = Map<string, Offer[]>;
type Chosen = Map<string, Offer>;

/** What an item with no quoted price is ranked at, per key (see `estimates`). */
type Estimates = Map<string, number>;

const priceOf = (chosen: Chosen, quantity: Map<string, number>, estimate: Estimates): number => {
  let total = 0;
  for (const [key, o] of chosen)
    total += (o.pricePaise ?? estimate.get(key) ?? 0) * (quantity.get(key) ?? 1);
  return total;
};

/** The middle of a list of prices (the lower middle for an even count). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

/**
 * A fair price for an item whose chosen offer has none: the median of what any shop quoted for it
 * (this errand's yes answers and learned stock alike), else its typical price, else none.
 */
function estimatesFor(wanted: Wanted[], offers: Offer[]): Estimates {
  const out: Estimates = new Map();
  for (const w of wanted) {
    const quoted = offers
      .filter((o) => o.itemId === w.itemId && o.pricePaise !== null)
      .map((o) => o.pricePaise as number);
    const guess = quoted.length > 0 ? median(quoted) : w.referencePricePaise;
    if (guess !== null) out.set(w.key, guess);
  }
  return out;
}

const usedShops = (chosen: Chosen): string[] => [
  ...new Set([...chosen.values()].map((o) => o.shopId)),
];

/** The shortest route over some chosen shops, for breaking ties; falls back to the nearest 8. */
function routeLengthM(start: Point, chosen: Chosen): number {
  const byShop = new Map<string, Offer>();
  for (const o of chosen.values()) byShop.set(o.shopId, o);
  const stops = [...byShop.values()]
    .sort((a, b) => a.distanceM - b.distanceM || a.shopId.localeCompare(b.shopId))
    .slice(0, MAX_STOPS)
    .map((o) => ({ shopId: o.shopId, label: o.shopName, lat: o.lat, lng: o.lng }));
  return stops.length === 0 ? 0 : planRoute(start, stops).totalM;
}

/**
 * The fewest shops that cover every item, found exactly: take the item with the fewest shops
 * that have it, try each of those shops, and go on with what is still uncovered. Branches that
 * already use more shops than the best cover found are dropped. Among covers of the same size,
 * each item is bought at its cheapest shop of the set; then the lower total price wins, then the
 * shorter route, then the lower shop ids (so the answer never depends on input order).
 */
function fewestShops(
  start: Point,
  keys: string[],
  candidates: Candidates,
  quantity: Map<string, number>,
  estimate: Estimates,
): Chosen {
  const sortedKeys = [...keys].sort();
  const shopsFor = new Map<string, string[]>(
    sortedKeys.map((k) => [k, (candidates.get(k) ?? []).map((o) => o.shopId)]),
  );

  const assign = (shops: ReadonlySet<string>): Chosen => {
    const chosen: Chosen = new Map();
    for (const key of sortedKeys) {
      const best = (candidates.get(key) ?? []).find((o) => shops.has(o.shopId));
      if (best) chosen.set(key, best);
    }
    return chosen;
  };

  const routeCache = new Map<string, number>();
  const distanceOf = (c: Chosen) => {
    const id = usedShops(c).sort().join(',');
    let d = routeCache.get(id);
    if (d === undefined) routeCache.set(id, (d = routeLengthM(start, c)));
    return d;
  };
  const better = (a: Chosen, b: Chosen): boolean => {
    const ka = usedShops(a).length;
    const kb = usedShops(b).length;
    if (ka !== kb) return ka < kb;
    const pa = priceOf(a, quantity, estimate);
    const pb = priceOf(b, quantity, estimate);
    if (pa !== pb) return pa < pb;
    const da = distanceOf(a);
    const db = distanceOf(b);
    if (da !== db) return da < db;
    return usedShops(a).sort().join(',') < usedShops(b).sort().join(',');
  };

  let best: Chosen | null = null;
  const seen = new Set<string>();
  const search = (picked: ReadonlySet<string>) => {
    const id = [...picked].sort().join(',');
    if (seen.has(id)) return;
    seen.add(id);
    const open = sortedKeys.filter((k) => !(shopsFor.get(k) ?? []).some((s) => picked.has(s)));
    if (open.length === 0) {
      const chosen = assign(picked);
      if (!best || better(chosen, best)) best = chosen;
      return;
    }
    if (best && picked.size + 1 > usedShops(best).length) return;
    // The item with the fewest ways to be covered goes first: it keeps the search small.
    const next = open.reduce((a, b) =>
      (shopsFor.get(b)?.length ?? 0) < (shopsFor.get(a)?.length ?? 0) ? b : a,
    );
    for (const shopId of shopsFor.get(next) ?? []) search(new Set([...picked, shopId]));
  };
  search(new Set());
  return best ?? new Map();
}

/** Keep the 8 shops nearest the user; the items of the rest cannot be planned. */
function capStops(chosen: Chosen): { kept: Chosen; dropped: string[] } {
  const nearest = new Map<string, number>();
  for (const o of chosen.values()) nearest.set(o.shopId, o.distanceM);
  const shops = [...nearest.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_STOPS)
    .map(([id]) => id);
  const kept: Chosen = new Map();
  const dropped: string[] = [];
  for (const [key, o] of [...chosen.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (shops.includes(o.shopId)) kept.set(key, o);
    else dropped.push(key);
  }
  return { kept, dropped };
}

function finish(
  kind: PlanKind,
  start: Point,
  wanted: Wanted[],
  chosen: Chosen,
  missing: string[],
  estimate: Estimates,
): OptimisedPlan {
  const { kept, dropped } = capStops(chosen);
  const byKey = new Map(wanted.map((w) => [w.key, w]));
  const assignments: Assignment[] = wanted
    .filter((w) => kept.has(w.key))
    .map((w) => ({ ...(kept.get(w.key) as Offer), key: w.key }));

  const stops = new Map<string, Offer>();
  for (const a of assignments) stops.set(a.shopId, a);
  let route: OptimisedPlan['route'] = null;
  if (stops.size > 0) {
    const best = planRoute(
      start,
      [...stops.values()]
        .sort((a, b) => a.shopId.localeCompare(b.shopId))
        .map((o) => ({ shopId: o.shopId, label: o.shopName, lat: o.lat, lng: o.lng })),
    );
    // Whole metres are plenty for a walk, and the total is the sum of what is shown.
    const legsM = best.legsM.map(Math.round);
    route = {
      orderedStops: best.orderedStops,
      legsM,
      totalM: legsM.reduce((a, b) => a + b, 0),
    };
  }

  let totalPricePaise = 0;
  let comparablePricePaise = 0;
  let savingsPaise = 0;
  const unknownPriceKeys: string[] = [];
  for (const a of assignments) {
    const w = byKey.get(a.key) as Wanted;
    if (a.pricePaise === null) {
      // Not ₹0: left out of the total, counted, and ranked at an estimate.
      unknownPriceKeys.push(a.key);
      comparablePricePaise += (estimate.get(a.key) ?? 0) * w.quantity;
      continue;
    }
    totalPricePaise += a.pricePaise * w.quantity;
    comparablePricePaise += a.pricePaise * w.quantity;
    if (w.referencePricePaise !== null)
      savingsPaise += (w.referencePricePaise - a.pricePaise) * w.quantity;
  }
  return {
    kind,
    assignments,
    notFound: missing,
    tooManyShops: dropped,
    shopIds: route ? route.orderedStops.map((s) => s.shopId) : [],
    route,
    totalPricePaise,
    unknownPriceKeys,
    comparablePricePaise,
    totalDistanceM: route?.totalM ?? 0,
    savingsPaise,
  };
}

/**
 * Two plans for the same errand.
 *  - sasta: the least money. Every item at its cheapest shop; among shops that tie on price, the
 *    fewest shops, then the shortest route.
 *  - kam_dukaan: the fewest shops that still cover every item that anyone has; then the least
 *    money, then the shortest route.
 */
export function optimise(
  start: Point,
  wanted: Wanted[],
  offers: Offer[],
): { sasta: OptimisedPlan; kam_dukaan: OptimisedPlan } {
  const quantity = new Map(wanted.map((w) => [w.key, w.quantity]));
  const all: Candidates = new Map();
  const missing: string[] = [];
  for (const w of wanted) {
    const usable = usableOffers(offers.filter((o) => o.itemId === w.itemId));
    if (usable.length === 0) missing.push(w.key);
    else all.set(w.key, usable);
  }
  const keys = [...all.keys()];
  const estimate = estimatesFor(wanted, offers);

  const cheapest: Candidates = new Map();
  for (const [key, list] of all) {
    const low = list[0]?.pricePaise ?? null;
    cheapest.set(
      key,
      list.filter((o) => o.pricePaise === low),
    );
  }
  return {
    sasta: finish(
      'sasta',
      start,
      wanted,
      fewestShops(start, keys, cheapest, quantity, estimate),
      missing,
      estimate,
    ),
    kam_dukaan: finish(
      'kam_dukaan',
      start,
      wanted,
      fewestShops(start, keys, all, quantity, estimate),
      missing,
      estimate,
    ),
  };
}

export interface Recommendation {
  recommended: PlanKind;
  /** What kam_dukaan costs more than sasta, in paise. */
  extraPaise: number;
  /** How many shops kam_dukaan saves. */
  stopsSaved: number;
  reason: 'no_stops_saved' | 'fewer_stops_within_limit' | 'fewer_stops_too_dear';
}

/** What `recommend` needs of a plan. */
export interface PlanCost {
  shopIds: string[];
  totalPricePaise: number;
  comparablePricePaise?: number;
}

/** kam_dukaan may cost this share of the sasta total more and still be recommended. */
export const FEWER_STOPS_MAX_EXTRA_PERCENT = 10;

/**
 * kam_dukaan if it saves at least one shop and costs at most `maxExtraPaise` more (default
 * ₹30) or at most 10 % more than sasta; otherwise sasta.
 */
export function recommend(
  sasta: PlanCost,
  kam: PlanCost,
  limits: { maxExtraPaise: number },
): Recommendation {
  // Comparable prices, so a missing price is neither a saving nor a cost (ADR-0031).
  const priced = (p: PlanCost) => p.comparablePricePaise ?? p.totalPricePaise;
  const extraPaise = priced(kam) - priced(sasta);
  const stopsSaved = sasta.shopIds.length - kam.shopIds.length;
  if (stopsSaved <= 0)
    return { recommended: 'sasta', extraPaise, stopsSaved: 0, reason: 'no_stops_saved' };
  const withinLimit =
    extraPaise <= limits.maxExtraPaise ||
    extraPaise * 100 <= priced(sasta) * FEWER_STOPS_MAX_EXTRA_PERCENT;
  return withinLimit
    ? { recommended: 'kam_dukaan', extraPaise, stopsSaved, reason: 'fewer_stops_within_limit' }
    : { recommended: 'sasta', extraPaise, stopsSaved, reason: 'fewer_stops_too_dear' };
}
