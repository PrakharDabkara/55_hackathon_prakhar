export const UPSTASH_FREE_COMMANDS_PER_MONTH = 500_000;
const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

/** Parses the output of `INFO commandstats` into { command: calls }. */
export function parseCommandStats(info: string): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const line of info.split(/\r?\n/)) {
    const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line);
    if (match?.[1] && match[2]) stats[match[1]] = Number(match[2]);
  }
  return stats;
}

export function extrapolate(totalCommands: number, seconds: number) {
  const perSecond = totalCommands / seconds;
  const perMonth = Math.round(perSecond * SECONDS_PER_MONTH);
  return {
    perSecond,
    perMonth,
    percentOfUpstashFree: (perMonth / UPSTASH_FREE_COMMANDS_PER_MONTH) * 100,
  };
}
