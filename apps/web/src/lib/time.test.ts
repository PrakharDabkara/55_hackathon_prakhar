import { describe, expect, it } from 'vitest';
import { agoFrom, timeAfter, timeOfDay } from './time.js';

const NOW = new Date('2026-10-16T10:30:00.000Z').getTime();

describe('agoFrom', () => {
  it('says now under a minute, then minutes, hours and days', () => {
    expect(agoFrom('2026-10-16T10:29:40.000Z', NOW)).toEqual({ unit: 'now' });
    expect(agoFrom('2026-10-16T10:25:00.000Z', NOW)).toEqual({ unit: 'min', n: 5 });
    expect(agoFrom('2026-10-16T07:30:00.000Z', NOW)).toEqual({ unit: 'hour', n: 3 });
    expect(agoFrom('2026-10-13T10:30:00.000Z', NOW)).toEqual({ unit: 'day', n: 3 });
  });

  it('never goes negative when the clocks disagree', () => {
    expect(agoFrom('2026-10-16T10:31:00.000Z', NOW)).toEqual({ unit: 'now' });
  });
});

describe('times of day', () => {
  it('writes 12-hour time with a lower-case am or pm', () => {
    expect(timeOfDay('2026-10-16T10:00:00.000Z')).toMatch(/^\d{1,2}:\d{2} [ap]m$/);
  });
  it('adds minutes', () => {
    const base = '2026-10-16T10:00:00.000Z';
    expect(timeAfter(base, 0)).toBe(timeOfDay(base));
    expect(timeAfter(base, 45)).toBe(timeOfDay('2026-10-16T10:45:00.000Z'));
  });
});
