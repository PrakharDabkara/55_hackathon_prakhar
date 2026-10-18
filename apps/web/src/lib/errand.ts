import type { PlanRoute, PlanVariant } from './seekerApi.js';

export interface MapStop {
  /** 1 for the first shop to visit. */
  n: number;
  shopId: string;
  label: string;
  lat: number;
  lng: number;
}

/** The route's shops numbered from 1, in the order to visit them. */
export const stopsForMap = (stops: PlanRoute['orderedStops']): MapStop[] =>
  stops.map((s, i) => ({ n: i + 1, shopId: s.shopId, label: s.label, lat: s.lat, lng: s.lng }));

/**
 * What the plan map draws: the customer, then every stop in route order. A stop whose coordinates
 * cannot be drawn (not a number, off the globe) is left out and counted, so one bad row can never
 * blank the map or send it to the wrong place; with nothing left, the start alone.
 */
export function mapPoints(
  origin: { lat: number; lng: number },
  stops: MapStop[],
): { points: [number, number][]; shown: MapStop[]; dropped: number } {
  const ok = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const shown = stops.filter((s) => ok(s.lat, s.lng));
  const points: [number, number][] = [
    ...(ok(origin.lat, origin.lng) ? [[origin.lat, origin.lng] as [number, number]] : []),
    ...shown.map((s): [number, number] => [s.lat, s.lng]),
  ];
  return { points, shown, dropped: stops.length - shown.length };
}

/**
 * A Google Maps link that walks from the customer through every shop in order: the last shop is
 * the destination and the others are waypoints. Null when there is nothing to visit.
 */
export function directionsForRoute(
  origin: { lat: number; lng: number },
  stops: PlanRoute['orderedStops'],
): string | null {
  const last = stops.at(-1);
  if (!last) return null;
  const point = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({
    api: '1',
    origin: point(origin),
    destination: point(last),
  });
  if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(point).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** The server adds a trailing "Jawab ka intezaar…"; the screen shows its own waiting state. */
export const shownProgress = (lines: string[]): string[] =>
  lines.filter((line) => !line.startsWith('Jawab ka intezaar'));

export const isFinalState = (state: string): boolean =>
  state === 'PLAN_READY' || state === 'FAILED' || state === 'EXPIRED' || state === 'CANCELLED';

/**
 * Two plans that buy the same things from the same shops at the same prices are one plan: the
 * screen then shows it once, with no tabs and no "recommended".
 */
export function plansIdentical(a: PlanVariant, b: PlanVariant): boolean {
  const key = (v: PlanVariant) =>
    JSON.stringify({
      items: v.items.map((i) => [i.text, i.itemId, i.status, i.shopId, i.pricePaise, i.quantity]),
      stops: (v.route?.orderedStops ?? []).map((s) => s.shopId),
    });
  return key(a) === key(b);
}
