import { describe, expect, it } from 'vitest';
import { createAttemptLimiter } from './attemptLimit.js';

describe('attempt limiter', () => {
  it('allows max tries per key in the window, then refuses', () => {
    const t = 0;
    const limiter = createAttemptLimiter({ max: 2, windowMs: 1000 }, () => t);
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limiter.allow('b')).toBe(true);
  });

  it('forgives once the window has passed', () => {
    let t = 0;
    const limiter = createAttemptLimiter({ max: 1, windowMs: 1000 }, () => t);
    limiter.allow('a');
    expect(limiter.allow('a')).toBe(false);
    t = 1500;
    expect(limiter.allow('a')).toBe(true);
  });
});
