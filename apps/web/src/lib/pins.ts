export type PinKind = 'user' | 'live' | 'learned';

/**
 * The marker for L.divIcon: one span, drawn by `.cu-map-pin*` in replies.css with tokens. It has
 * no style attribute (the Content-Security-Policy forbids inline style, ADR-0017) and no image file.
 */
export function pinHtml(kind: PinKind): string {
  return `<span class="cu-map-pin cu-map-pin--${kind}"></span>`;
}

/**
 * Identifies the set of pins on the map: which shops, of which kind, where. The map zooms to fit
 * everything whenever this changes, so a shop that answers (a new pin, or a learned pin turning
 * live) is never left outside the view.
 */
export function pinsKey(
  pins: readonly { id: string; kind: string; lat: number; lng: number }[],
): string {
  return pins
    .map((p) => `${p.id}:${p.kind}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .sort()
    .join('|');
}
