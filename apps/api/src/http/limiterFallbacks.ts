import type { Logger } from 'pino';

export interface LimiterFallback {
  reason: 'error' | 'timeout';
  /** The limiter's name (`request`, `verify`, `api`...). Never the key: it ends in an IP. */
  bucket: string;
}

export interface FallbackMonitor {
  record(fallback: LimiterFallback): void;
  /** Fallbacks since 00:00 UTC. In this process, so it starts again on a restart. */
  fallbacksToday(): number;
}

/**
 * Counts the times a limiter counted in memory because Redis failed, and logs a warn line about it.
 * When Redis is down every request falls back, so the line is written at most once per
 * `logEveryMs`; it carries how many fallbacks happened since the last line.
 */
export function createFallbackMonitor({
  logger,
  now = Date.now,
  logEveryMs = 60_000,
}: {
  logger: Logger;
  now?: () => number;
  logEveryMs?: number;
}): FallbackMonitor {
  const day = () => new Date(now()).toISOString().slice(0, 10);
  let today = { day: day(), count: 0 };
  let sinceLastLog = 0;
  let lastLogAt = Number.NEGATIVE_INFINITY;
  return {
    record({ reason, bucket }) {
      if (today.day !== day()) today = { day: day(), count: 0 };
      today.count += 1;
      sinceLastLog += 1;
      if (now() - lastLogAt < logEveryMs) return;
      lastLogAt = now();
      logger.warn(
        { reason, bucket, fallbacks: sinceLastLog },
        'ip limit counted in memory: Redis failed',
      );
      sinceLastLog = 0;
    },
    fallbacksToday() {
      return today.day === day() ? today.count : 0;
    },
  };
}
