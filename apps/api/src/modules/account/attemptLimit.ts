/**
 * At most `max` tries per person per window, in memory (ADR-0054). Account deletion is rare and one
 * server process handles it, so a counter in the process is enough; a restart only forgives.
 * Entries of people who stopped trying are dropped as the window passes.
 */
export interface AttemptLimiter {
  /** True if this try may go ahead; counts it either way it is asked. */
  allow(key: string): boolean;
}

export function createAttemptLimiter(
  { max, windowMs }: { max: number; windowMs: number },
  now: () => number = Date.now,
): AttemptLimiter {
  const tries = new Map<string, number[]>();
  return {
    allow(key) {
      const at = now();
      for (const [k, times] of tries) {
        if (times.every((t) => at - t >= windowMs)) tries.delete(k);
      }
      const recent = (tries.get(key) ?? []).filter((t) => at - t < windowMs);
      recent.push(at);
      tries.set(key, recent);
      return recent.length <= max;
    },
  };
}
