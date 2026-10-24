import { describe, expect, it } from 'vitest';
import { runWithRetries } from './evalRetry.js';

/** A counter of failed model calls that the fake attempts bump. */
const harness = (failuresPerAttempt: number[]) => {
  let failed = 0;
  let attempts = 0;
  return {
    failedCount: async () => failed,
    attempt: async () => {
      failed += failuresPerAttempt[attempts] ?? 0;
      return ++attempts;
    },
    attempts: () => attempts,
  };
};

const noPause = async () => {};

describe('runWithRetries', () => {
  it('does not retry a clean first attempt', async () => {
    const h = harness([0]);
    const r = await runWithRetries(h.attempt, h.failedCount, 1, noPause);
    expect(r).toEqual({ value: 1, errored: false });
  });

  it('is not an error when the retry succeeds after a failed first attempt', async () => {
    const h = harness([1, 0]);
    let retried = 0;
    const r = await runWithRetries(h.attempt, h.failedCount, 1, noPause, () => retried++);
    expect(r).toEqual({ value: 2, errored: false });
    expect(retried).toBe(1);
  });

  it('is an error when the retry fails too, and stops after the retries', async () => {
    const h = harness([1, 1, 0]);
    const r = await runWithRetries(h.attempt, h.failedCount, 1, noPause);
    expect(r).toEqual({ value: 2, errored: true });
    expect(h.attempts()).toBe(2);
  });
});
