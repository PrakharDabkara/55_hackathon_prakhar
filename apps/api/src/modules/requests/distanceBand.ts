/** What a shop is told about how far the asker is: a band, never a position. */
export function distanceBand(distanceM: number): string {
  if (distanceM < 1000) return 'under 1 km';
  if (distanceM < 2000) return '1–2 km';
  return '2–5 km';
}
