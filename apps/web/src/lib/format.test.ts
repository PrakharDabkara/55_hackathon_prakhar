import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDistance } from './format.js';

describe('formatDistance', () => {
  it('uses metres below a kilometre and one decimal above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1 km');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(4960)).toBe('5 km');
  });
});

describe('formatCountdown', () => {
  it('shows minutes and seconds', () => {
    expect(formatCountdown(12 * 60_000)).toBe('12:00');
    expect(formatCountdown(754_000)).toBe('12:34');
    expect(formatCountdown(9_000)).toBe('0:09');
  });

  it('never goes below zero, and rounds a part-second up so it ends exactly at 0:00', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5000)).toBe('0:00');
    expect(formatCountdown(1)).toBe('0:01');
  });
});
