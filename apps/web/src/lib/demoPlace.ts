import { DEMO_PLACE } from '@askbuy/shared';

export { DEMO_PLACE };

const KEY = 'km-demo-area';

/** Metres between two points (haversine). */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Within this far of the demo place, a person is "already there". */
export const IN_DEMO_AREA_M = 3000;

export const inDemoArea = (place: { lat: number; lng: number }): boolean =>
  metresBetween(place, DEMO_PLACE) < IN_DEMO_AREA_M;

/** The customer pressed Change on the banner: for this tab's session, use their own location. */
export function demoAreaDeclined(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

export function declineDemoArea(): void {
  try {
    sessionStorage.setItem(KEY, 'off');
  } catch {
    // Blocked storage: the choice lives until the screen is closed.
  }
}
