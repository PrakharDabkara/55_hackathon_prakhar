/** 100 → "1m 40s", 45 → "45s", 3900 → "1h 5m"; null (no replies yet) → "—". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** { 5, 'kg' } → "5 kg"; { 1.5, 'l' } → "1.5 L". */
export function formatQuantity(
  quantity: { quantity: number; unit: string } | undefined,
): string | null {
  if (!quantity) return null;
  return `${quantity.quantity} ${quantity.unit === 'l' ? 'L' : quantity.unit}`;
}

/** Whole minutes left (rounded up), never negative. */
export function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

/** 1 when the window has just opened, 0 when it is over. */
export function ringFraction(startedAt: string, expiresAt: string, now: number): number {
  const total = Date.parse(expiresAt) - Date.parse(startedAt);
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (Date.parse(expiresAt) - now) / total));
}

/** Whether a timestamp falls on the same local day as `now`. */
export function isToday(timestamp: string, now: Date = new Date()): boolean {
  const date = new Date(timestamp);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** "6:12 pm" in the shop's own clock. */
export function formatClock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
