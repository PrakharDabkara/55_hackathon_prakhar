import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDistance } from './format.js';

describe('formatDistance', () => {
  it('says "Under 100 m" below 100 m', () => {
    expect(formatDistance(0)).toBe('Under 100 m');
    expect(formatDistance(60)).toBe('Under 100 m');
    expect(formatDistance(99)).toBe('Under 100 m');
  });

  it('rounds to the nearest 50 m below a kilometre', () => {
    expect(formatDistance(100)).toBe('100 m');
    expect(formatDistance(574)).toBe('550 m');
    expect(formatDistance(600)).toBe('600 m');
    expect(formatDistance(626)).toBe('650 m');
    expect(formatDistance(960)).toBe('950 m');
  });

  it('never prints 1000 m: a rounded kilometre is "1 km"', () => {
    expect(formatDistance(980)).toBe('1 km');
    expect(formatDistance(999)).toBe('1 km');
  });

  it('uses one decimal from a kilometre', () => {
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
