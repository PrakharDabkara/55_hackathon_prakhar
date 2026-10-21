import { loadDraft } from './draft.js';

export interface Place {
  lat: number;
  lng: number;
}

const inRange = (value: number, limit: number) =>
  Number.isFinite(value) && Math.abs(value) <= limit;

/** The place the customer set on Find (kept in the tab's draft), if any. */
export function draftPlace(): Place | null {
  const draft = loadDraft();
  if (draft.lat.trim() === '' || draft.lng.trim() === '') return null;
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  return inRange(lat, 90) && inRange(lng, 180) ? { lat, lng } : null;
}

/** Asks the phone where it is. Null when it cannot say (no support, refused, timed out). */
export function locate(): Promise<Place | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

/** Where to search from: the place set on Find, else the phone's own. */
export async function placeToSearch(): Promise<Place | null> {
  return draftPlace() ?? (await locate());
}
