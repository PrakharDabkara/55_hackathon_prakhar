export type PinKind = 'user' | 'live' | 'learned';

export const PIN_COLOURS: Record<PinKind, string> = {
  user: '#e8590c',
  live: '#0a6b35',
  learned: '#1c5fd4',
};

/**
 * Inline SVG for L.divIcon, so there are no marker image files to ship or load. It carries no
 * style attribute: the Content-Security-Policy forbids inline style (ADR-0017).
 */
export function pinSvg(kind: PinKind): string {
  const colour = PIN_COLOURS[kind];
  if (kind === 'user') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8" fill="${colour}" stroke="#ffffff" stroke-width="3"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 38C15 38 3 24 3 14a12 12 0 0 1 24 0c0 10-12 24-12 24z" fill="${colour}" stroke="#ffffff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#ffffff"/></svg>`;
}
