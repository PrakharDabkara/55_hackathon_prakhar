/** The holdout sets: their cases are never named in a log, only counted. */
export const isHoldoutSet = (set: string) => set === 'holdout' || set.startsWith('holdout-');

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/**
 * One line every `every` cases (and one at the end) so a long eval run shows it is alive. It takes
 * counts only: nothing about a case, so a holdout case cannot leak through it. `label` is the set
 * name, chosen by the script.
 */
export function createProgress({
  label,
  total,
  every = 10,
  log = (line) => console.log(line),
  now = Date.now,
}: {
  label: string;
  total: number;
  every?: number;
  log?: (line: string) => void;
  now?: () => number;
}) {
  const started = now();
  let finished = 0;
  let passes = 0;
  let retries = 0;
  return {
    /** A model call was tried again. */
    retried(): void {
      retries++;
    },
    /** One case finished. */
    done(passed: boolean): void {
      finished++;
      if (passed) passes++;
      if (finished % every === 0 || finished === total)
        log(
          `progress ${label}: ${finished}/${total}, passes ${passes}, retries ${retries}, elapsed ${clock(now() - started)}`,
        );
    },
  };
}
