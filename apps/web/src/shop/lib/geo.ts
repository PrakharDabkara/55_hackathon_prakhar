export interface LatLng {
  lat: number;
  lng: number;
}

/** Indore, Rajwada: where the map opens when the phone gives no location (as in the customer app). */
export const DEFAULT_CENTRE: LatLng = { lat: 22.7196, lng: 75.8577 };

/** How far one arrow key press moves the pin, in screen pixels. */
export const NUDGE_PX = 12;

/** Arrow key → how many pixels to move right and down; null for any other key. */
export function arrowDelta(key: string, step = NUDGE_PX): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/** A position that can be sent to the server: finite and on the globe. */
export const isValidPosition = (p: LatLng): boolean =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180;

/** Asks the phone where it is. Resolves null when denied or not available. */
export function currentPosition(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}
