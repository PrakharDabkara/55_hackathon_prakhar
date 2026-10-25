/** What the customer has typed on Find, kept for the tab so a login or a reload does not lose it. */
export interface Draft {
  query: string;
  wantsDelivery: boolean;
  address: string;
  lat: string;
  lng: string;
}

const KEY = 'km-find-draft';

export const emptyDraft: Draft = { query: '', wantsDelivery: false, address: '', lat: '', lng: '' };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The saved draft, or an empty one. Storage can be blocked or hold junk: neither throws. */
export function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...emptyDraft };
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      query: text(data['query']),
      wantsDelivery: data['wantsDelivery'] === true,
      address: text(data['address']),
      lat: text(data['lat']),
      lng: text(data['lng']),
    };
  } catch {
    return { ...emptyDraft };
  }
}

export function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Private mode or blocked storage: the draft just lives in memory.
  }
}

const PLACE_KEY = 'km-find-place';

/** The place a search was sent from, kept for the tab: the next Find starts from it, not from a prompt. */
export function loadPlace(): { lat: string; lng: string } {
  try {
    const data = JSON.parse(sessionStorage.getItem(PLACE_KEY) ?? '{}') as Record<string, unknown>;
    return { lat: text(data['lat']), lng: text(data['lng']) };
  } catch {
    return { lat: '', lng: '' };
  }
}

export function savePlace(place: { lat: number; lng: number }): void {
  try {
    sessionStorage.setItem(
      PLACE_KEY,
      JSON.stringify({ lat: String(place.lat), lng: String(place.lng) }),
    );
  } catch {
    // Blocked storage: the next Find asks again.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
