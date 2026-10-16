export interface Point {
  lat: number;
  lng: number;
}

export interface Stop extends Point {
  shopId: string;
  label: string;
}

export interface RoutePlan {
  orderedStops: Stop[];
  /** Distance of each leg in metres: start to the first stop, then stop to stop. */
  legsM: number[];
  totalM: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const MAX_STOPS = 8;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line (great-circle) distance in metres. */
export function haversineM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The shortest path from `start` through every stop, ending at the last one (no return). Tries
 * every order, which is exact and cheap for up to 8 stops (8! = 40,320); branches already longer
 * than the best found are dropped. When two orders tie, the one nearer the given order wins.
 */
export function planRoute(start: Point, stops: readonly Stop[]): RoutePlan {
  if (stops.length < 1 || stops.length > MAX_STOPS) {
    throw new RangeError(`A route needs 1 to ${MAX_STOPS} stops, got ${stops.length}`);
  }
  const n = stops.length;
  // Distances between every pair once, so the search only does lookups.
  const fromStart = stops.map((s) => haversineM(start, s));
  const between = stops.map((a) => stops.map((b) => haversineM(a, b)));

  let bestTotal = Infinity;
  let bestOrder: number[] = [];
  const order: number[] = [];
  const used = new Array<boolean>(n).fill(false);

  const visit = (last: number, sum: number) => {
    if (sum >= bestTotal) return;
    if (order.length === n) {
      bestTotal = sum;
      bestOrder = [...order];
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const leg =
        last === -1 ? (fromStart[i] as number) : ((between[last] as number[])[i] as number);
      used[i] = true;
      order.push(i);
      visit(i, sum + leg);
      order.pop();
      used[i] = false;
    }
  };
  visit(-1, 0);

  const orderedStops = bestOrder.map((i) => stops[i] as Stop);
  const legsM = bestOrder.map((stopIndex, k) =>
    k === 0
      ? (fromStart[stopIndex] as number)
      : ((between[bestOrder[k - 1] as number] as number[])[stopIndex] as number),
  );
  return { orderedStops, legsM, totalM: legsM.reduce((a, b) => a + b, 0) };
}
