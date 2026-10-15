/** 350 → "350 m", 1234 → "1.2 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = Math.round(metres / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** Milliseconds left → "12:34". Never negative; a part-second counts as a whole one. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  return `${Math.floor(total / 60)}:${seconds}`;
}
