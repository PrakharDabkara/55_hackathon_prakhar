import { describe, expect, it } from 'vitest';
import { distanceBand } from './distanceBand.js';

describe('distanceBand', () => {
  it.each([
    [0, 'under 1 km'],
    [999, 'under 1 km'],
    [1000, '1–2 km'],
    [1999, '1–2 km'],
    [2000, '2–5 km'],
    [4800, '2–5 km'],
  ])('%i m is "%s"', (metres, label) => {
    expect(distanceBand(metres)).toBe(label);
  });
});
