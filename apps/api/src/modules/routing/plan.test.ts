import { describe, expect, it } from 'vitest';
import { haversineM, planRoute } from './plan.js';

const stop = (shopId: string, lat: number, lng: number) => ({
  shopId,
  lat,
  lng,
  label: shopId.toUpperCase(),
});

// One degree of latitude is about 111.2 km.
const KM = 1 / 111.195;

describe('haversineM', () => {
  it('is 0 for the same point and about 111 km per degree of latitude', () => {
    expect(haversineM({ lat: 22.7, lng: 75.8 }, { lat: 22.7, lng: 75.8 })).toBe(0);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });

  it('knows a degree of longitude is shorter away from the equator', () => {
    const atEquator = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const atIndore = haversineM({ lat: 22.7, lng: 75.8 }, { lat: 22.7, lng: 76.8 });
    expect(atIndore).toBeLessThan(atEquator * 0.93);
  });
});

describe('planRoute (shortest path from the start through every stop, no return)', () => {
  const start = { lat: 22.7, lng: 75.8 };

  it('visits stops on a line in the order along it, whatever order they are given in', () => {
    const plan = planRoute(start, [
      stop('c', 22.7 + 3 * KM, 75.8),
      stop('a', 22.7 + 1 * KM, 75.8),
      stop('b', 22.7 + 2 * KM, 75.8),
    ]);
    expect(plan.orderedStops.map((s) => s.shopId)).toEqual(['a', 'b', 'c']);
    expect(plan.legsM).toHaveLength(3);
    for (const leg of plan.legsM) expect(leg).toBeCloseTo(1000, -1);
    expect(plan.totalM).toBe(plan.legsM.reduce((a, b) => a + b, 0));
    expect(plan.totalM).toBeCloseTo(3000, -1);
  });

  it('beats the nearest-first guess when that is not optimal', () => {
    // Start in the middle of a line: 1 km west is stop w, 1.2 km east is stop e1, 2.4 km east is e2.
    // Nearest-first goes w (1000), then e1 (2200), then e2 (1200) = 4400. Going east first and
    // west last is longer; west first is the best here, so check a layout where it flips:
    // w at 3 km west, e1 at 1 km east, e2 at 2 km east. Nearest-first: e1, e2, w = 1+1+5 = 7 km.
    // Optimal: e1, e2 first then w is 7; w first then e1, e2 is 3+4+1 = 8; so 7 km is optimal.
    const lng = (km: number) => 75.8 + km / (111.195 * Math.cos((22.7 * Math.PI) / 180));
    const plan = planRoute(start, [
      stop('w', 22.7, lng(-3)),
      stop('e2', 22.7, lng(2)),
      stop('e1', 22.7, lng(1)),
    ]);
    expect(plan.orderedStops.map((s) => s.shopId)).toEqual(['e1', 'e2', 'w']);
    expect(plan.totalM).toBeCloseTo(7000, -2);
  });

  it('finds the exact optimum for 8 stops (checked against a brute-force over all orders)', () => {
    const pts = Array.from({ length: 8 }, (_, i) =>
      stop(`s${i}`, 22.7 + Math.sin(i * 2.1) * 0.01, 75.8 + Math.cos(i * 1.3) * 0.01),
    );
    const plan = planRoute(start, pts);
    let best = Infinity;
    const walk = (at: { lat: number; lng: number }, left: typeof pts, sum: number) => {
      if (left.length === 0) return void (best = Math.min(best, sum));
      left.forEach((p, i) =>
        walk(p, [...left.slice(0, i), ...left.slice(i + 1)], sum + haversineM(at, p)),
      );
    };
    walk(start, pts, 0);
    expect(plan.totalM).toBeCloseTo(best, 3);
    expect(new Set(plan.orderedStops.map((s) => s.shopId)).size).toBe(8);
  });

  it('keeps the given order when two routes are equally long', () => {
    const plan = planRoute(start, [stop('x', 22.7 + KM, 75.8), stop('y', 22.7 + KM, 75.8)]);
    expect(plan.orderedStops.map((s) => s.shopId)).toEqual(['x', 'y']);
  });

  it('handles one stop, and carries label and position through', () => {
    const plan = planRoute(start, [stop('only', 22.71, 75.81)]);
    expect(plan.orderedStops).toEqual([{ shopId: 'only', lat: 22.71, lng: 75.81, label: 'ONLY' }]);
    expect(plan.legsM).toHaveLength(1);
  });

  it('refuses 0 stops and more than 8', () => {
    expect(() => planRoute(start, [])).toThrow(RangeError);
    const nine = Array.from({ length: 9 }, (_, i) => stop(`s${i}`, 22.7 + i / 1000, 75.8));
    expect(() => planRoute(start, nine)).toThrow(RangeError);
  });
});
