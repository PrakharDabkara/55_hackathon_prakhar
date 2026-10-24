export type ModelState =
  | { state: 'ok' }
  | { state: 'exhausted'; until: number; reason: string }
  | { state: 'unavailable'; reason: string };

/** What /admin/health/details shows for one model. `until` is an ISO time. */
export interface ModelStateView {
  model: string;
  state: ModelState['state'];
  until?: string;
  reason?: string;
}

const PACIFIC = 'America/Los_Angeles';

/** Wall-clock time in Los Angeles at `at`, read as if it were UTC. */
function pacificAsUtc(at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
}

/**
 * The next midnight in America/Los_Angeles, as epoch milliseconds: when Google's daily quotas reset.
 * Follows daylight saving (the offset is read at the target day, not today).
 */
export function nextMidnightPacific(at: number): number {
  const local = pacificAsUtc(at);
  const day = new Date(local);
  const targetLocal = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
  // First guess with today's offset, then correct once with the offset at the guess.
  let guess = at + (targetLocal - local);
  guess += targetLocal - pacificAsUtc(guess);
  return guess;
}

/**
 * What this process knows about each model: fine, used up for the day (until a time), or gone (a
 * 404: until the process restarts). In memory on purpose: a restart is a fresh look.
 */
export class ModelHealth {
  private readonly states = new Map<string, ModelState>();

  constructor(private readonly now: () => number) {}

  get(model: string): ModelState {
    const known = this.states.get(model);
    if (known?.state === 'exhausted' && known.until <= this.now()) {
      this.states.delete(model);
      return { state: 'ok' };
    }
    return known ?? { state: 'ok' };
  }

  usable(model: string): boolean {
    return this.get(model).state === 'ok';
  }

  markExhausted(model: string, until: number, reason: string): void {
    if (this.get(model).state === 'unavailable') return;
    this.states.set(model, { state: 'exhausted', until, reason });
  }

  /** True the first time, so the caller logs the ERROR once. */
  markUnavailable(model: string, reason: string): boolean {
    const first = this.get(model).state !== 'unavailable';
    this.states.set(model, { state: 'unavailable', reason });
    return first;
  }

  view(model: string): ModelStateView {
    const s = this.get(model);
    return {
      model,
      state: s.state,
      ...(s.state === 'exhausted' && { until: new Date(s.until).toISOString() }),
      ...(s.state !== 'ok' && { reason: s.reason }),
    };
  }
}
