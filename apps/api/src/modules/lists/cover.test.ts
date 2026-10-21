import { describe, expect, it } from 'vitest';
import { bestCover, type CoverShop } from './cover.js';

// Origin at (0,0); one degree of longitude at the equator is about 111 km.
const origin = { lat: 0, lng: 0 };
const east = (km: number) => ({ lat: 0, lng: km / 111.195 });
const shop = (shopId: string, km: number, have: Record<number, number>): CoverShop => ({
  shopId,
  ...east(km),
  have: new Map(Object.entries(have).map(([k, v]) => [Number(k), v])),
});
const ids = (plan: ReturnType<typeof bestCover>) => [...plan.stops].sort();

describe('bestCover (ADR-0055 rule 10)', () => {
  it('one shop that has everything is the plan', () => {
    const plan = bestCover(
      origin,
      [shop('all', 1, { 0: 100, 1: 200 }), shop('one', 0.5, { 0: 50 })],
      [0, 1],
    );
    expect(plan.stops).toEqual(['all']);
    expect(plan.assignments.map((x) => [x.position, x.shopId])).toEqual([
      [0, 'all'],
      [1, 'all'],
    ]);
    expect(plan.totalPaise).toBe(300);
    expect(plan.missing).toEqual([]);
  });

  it('finds the smallest set even when a greedy pick would use more', () => {
    // Greedy takes "big" (lines 0,1,2) then needs two more shops for 3 and 4; the exact answer is a+b.
    const shops = [
      shop('big', 1, { 0: 1, 1: 1, 2: 1 }),
      shop('a', 1, { 0: 1, 1: 1, 3: 1 }),
      shop('b', 1, { 2: 1, 4: 1 }),
      shop('c', 1, { 3: 1 }),
      shop('d', 1, { 4: 1 }),
    ];
    const plan = bestCover(origin, shops, [0, 1, 2, 3, 4]);
    expect(ids(plan)).toEqual(['a', 'b']);
  });

  it('breaks a tie in size by the shortest route', () => {
    // Either "near" or "far" can cover line 1 together with "hub"; near gives the shorter walk.
    const shops = [
      shop('hub', 1, { 0: 10 }),
      shop('near', 2, { 1: 10 }),
      shop('far', 9, { 1: 10 }),
    ];
    expect(ids(bestCover(origin, shops, [0, 1]))).toEqual(['hub', 'near']);
  });

  it('then by the lower total price', () => {
    // Same stops-count and the same route length (both candidates sit at the same place).
    const shops = [shop('dear', 2, { 0: 90 }), shop('cheap', 2, { 0: 40 })];
    const plan = bestCover(origin, shops, [0]);
    expect(plan.stops).toEqual(['cheap']);
    expect(plan.totalPaise).toBe(40);
  });

  it('assigns each line to the cheapest shop in the chosen set', () => {
    const shops = [shop('x', 1, { 0: 100, 1: 500 }), shop('y', 1.5, { 0: 80, 2: 30 })];
    const plan = bestCover(origin, shops, [0, 1, 2]);
    expect(plan.assignments.find((a) => a.position === 0)).toMatchObject({
      shopId: 'y',
      pricePaise: 80,
    });
    expect(plan.assignments.find((a) => a.position === 1)?.shopId).toBe('x');
  });

  it('lists lines nobody has as missing and still covers the rest', () => {
    const plan = bestCover(origin, [shop('x', 1, { 0: 5 })], [0, 1, 2]);
    expect(plan.missing).toEqual([1, 2]);
    expect(plan.stops).toEqual(['x']);
  });

  it('orders the stops by the shortest route from the customer', () => {
    const shops = [shop('far', 8, { 0: 1 }), shop('near', 1, { 1: 1 })];
    expect(bestCover(origin, shops, [0, 1]).stops).toEqual(['near', 'far']);
  });

  it('has no plan when nobody answered with anything', () => {
    expect(bestCover(origin, [], [0, 1])).toMatchObject({
      stops: [],
      assignments: [],
      missing: [0, 1],
      totalPaise: 0,
      totalM: 0,
    });
  });

  it('handles eight shops, the most a list can have, by trying every subset', () => {
    const shops = Array.from({ length: 8 }, (_, i) =>
      shop(`s${i}`, i + 1, { [i]: 10, [(i + 1) % 8]: 10 }),
    );
    const plan = bestCover(origin, shops, [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(plan.stops).toHaveLength(4); // each shop covers two neighbouring lines
    expect(plan.missing).toEqual([]);
  });
});
