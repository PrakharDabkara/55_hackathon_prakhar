import { describe, expect, it } from 'vitest';
import { createProgress, isHoldoutSet } from './evalProgress.js';

function setup(total: number, every = 10) {
  const lines: string[] = [];
  let t = 0;
  const progress = createProgress({
    label: 'dev',
    total,
    every,
    log: (l) => lines.push(l),
    now: () => t,
  });
  return { progress, lines, tick: (ms: number) => (t += ms) };
}

describe('eval progress lines', () => {
  it('prints one line every 10 cases with counts only', () => {
    const s = setup(25);
    for (let i = 0; i < 25; i++) {
      s.tick(1000);
      if (i === 3) s.progress.retried();
      s.progress.done(i % 2 === 0);
    }
    expect(s.lines).toEqual([
      'progress dev: 10/25, passes 5, retries 1, elapsed 0:10',
      'progress dev: 20/25, passes 10, retries 1, elapsed 0:20',
      'progress dev: 25/25, passes 13, retries 1, elapsed 0:25',
    ]);
  });

  it('formats long runs as minutes and hours', () => {
    const s = setup(1, 1);
    s.tick(3_725_000);
    s.progress.done(true);
    expect(s.lines[0]).toMatch(/elapsed 1:02:05$/);
  });

  it('takes only numbers: no case text can reach a line', () => {
    const s = setup(10);
    for (let i = 0; i < 10; i++) s.progress.done(true);
    expect(s.lines.join('\n')).toMatch(
      /^progress dev: 10\/10, passes 10, retries 0, elapsed 0:00$/,
    );
  });
});

describe('holdout sets', () => {
  it('are recognised, so their cases are never named in the log', () => {
    expect(isHoldoutSet('holdout')).toBe(true);
    expect(isHoldoutSet('holdout-v2')).toBe(true);
    expect(isHoldoutSet('dev')).toBe(false);
    expect(isHoldoutSet('list-dev')).toBe(false);
  });
});
