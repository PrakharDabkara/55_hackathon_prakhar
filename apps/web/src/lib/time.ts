/** How long ago something happened, as a number and a unit; screens put it in words. */
export type Ago = { unit: 'now' } | { unit: 'min' | 'hour' | 'day'; n: number };

export function agoFrom(iso: string, now: number = Date.now()): Ago {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'min', n: minutes };
  if (minutes < 24 * 60) return { unit: 'hour', n: Math.floor(minutes / 60) };
  return { unit: 'day', n: Math.floor(minutes / (24 * 60)) };
}

/** "5:42 pm" in the viewer's own time zone. */
export function timeOfDay(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?([ap])m$/i, (_, letter: string) => ` ${letter.toLowerCase()}m`);
}

/** The time `minutes` after `iso`, as a time of day. */
export function timeAfter(iso: string, minutes: number): string {
  return timeOfDay(new Date(new Date(iso).getTime() + minutes * 60_000).toISOString());
}
