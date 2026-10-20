import { describe, expect, it } from 'vitest';
import {
  directionsForRoute,
  isActiveErrand,
  resumableErrand,
  haversineM,
  mapPoints,
  plansDiffer,
  roundTripM,
  shownProgress,
  stopsForMap,
} from './errand.js';
import type { ErrandListItem, PlanVariant } from './seekerApi.js';

const origin = { lat: 22.7196, lng: 75.8577 };
const stops = [
  { shopId: 'a', label: 'Mishra Kirana', lat: 22.72, lng: 75.86 },
  { shopId: 'b', label: 'Gupta Store', lat: 22.73, lng: 75.87 },
  { shopId: 'c', label: 'Jain Mart', lat: 22.74, lng: 75.88 },
];

describe('directionsForRoute', () => {
  it('opens Google Maps from the user to the last stop through the others, in route order', () => {
    const url = new URL(directionsForRoute(origin, stops) as string);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('22.7196,75.8577');
    expect(url.searchParams.get('destination')).toBe('22.74,75.88');
    expect(url.searchParams.get('waypoints')).toBe('22.72,75.86|22.73,75.87');
  });

  it('has no waypoints for a single stop', () => {
    const url = new URL(directionsForRoute(origin, stops.slice(0, 1)) as string);
    expect(url.searchParams.get('destination')).toBe('22.72,75.86');
    expect(url.searchParams.has('waypoints')).toBe(false);
  });

  it('is null without a route', () => {
    expect(directionsForRoute(origin, [])).toBeNull();
  });
});

describe('stopsForMap', () => {
  it('numbers the stops from 1 in route order', () => {
    expect(stopsForMap(stops).map((s) => [s.n, s.label])).toEqual([
      [1, 'Mishra Kirana'],
      [2, 'Gupta Store'],
      [3, 'Jain Mart'],
    ]);
  });
});

describe('shownProgress (English from the server)', () => {
  it('drops the "Waiting for shops…" marker and the question line', () => {
    expect(
      shownProgress(['Understood: 3 items', 'Waiting for shops…', 'Question for you: Which tea?']),
    ).toEqual(['Understood: 3 items']);
  });
});

describe('haversineM', () => {
  it('is 0 for the same point and about 111 km for one degree of latitude', () => {
    expect(haversineM(origin, origin)).toBe(0);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -2);
  });
  it('is symmetric', () => {
    const a = haversineM(origin, stops[2] as (typeof stops)[number]);
    expect(haversineM(stops[2] as (typeof stops)[number], origin)).toBeCloseTo(a, 6);
  });
});

describe('roundTripM', () => {
  const route = (n: number) => ({
    orderedStops: stops.slice(0, n),
    legsM: [],
    totalM: 1000,
  });
  it('is the route plus the straight line from the last stop back to the start', () => {
    const back = haversineM(stops[1] as (typeof stops)[number], origin);
    expect(roundTripM(origin, route(2))).toBeCloseTo(1000 + back, 6);
  });
  it('is null without a route or without stops', () => {
    expect(roundTripM(origin, null)).toBeNull();
    expect(roundTripM(origin, route(0))).toBeNull();
  });
  it('is null when the start cannot be placed', () => {
    expect(roundTripM({ lat: Number.NaN, lng: 1 }, route(1))).toBeNull();
  });
});

describe('plansDiffer', () => {
  const v = (over: Partial<PlanVariant>) =>
    ({ shopCount: 1, totalPricePaise: 100, ...over }) as PlanVariant;
  it('is true when the shop count or the total differs, the total being the grand total when known', () => {
    expect(plansDiffer(v({}), v({ shopCount: 2 }))).toBe(true);
    expect(plansDiffer(v({}), v({ totalPricePaise: 200 }))).toBe(true);
    expect(plansDiffer(v({}), v({ grandTotalPaise: 150 }))).toBe(true);
  });
  it('is false for the same count and total', () => {
    expect(plansDiffer(v({}), v({}))).toBe(false);
    expect(plansDiffer(v({}), v({ grandTotalPaise: 100 }))).toBe(false);
  });
});

describe('shownProgress (old marker)', () => {
  it('drops the "Jawab ka intezaar…" marker: the screen has its own waiting state', () => {
    expect(shownProgress(['Samjha: 3 cheezein', 'Jawab ka intezaar…'])).toEqual([
      'Samjha: 3 cheezein',
    ]);
  });
});

describe('mapPoints: what the plan map must show', () => {
  const origin = { lat: 22.7196, lng: 75.8577 };
  const stops = [
    { n: 1, shopId: 'a', label: 'A', lat: 22.72, lng: 75.86 },
    { n: 2, shopId: 'b', label: 'B', lat: 22.73, lng: 75.87 },
  ];

  it('is the customer first, then every stop in route order', () => {
    expect(mapPoints(origin, stops)).toEqual({
      points: [
        [22.7196, 75.8577],
        [22.72, 75.86],
        [22.73, 75.87],
      ],
      shown: stops,
      dropped: 0,
    });
  });

  it('drops a stop with a coordinate that cannot be drawn, so one bad row cannot blank the map', () => {
    const bad = [
      ...stops,
      { n: 3, shopId: 'c', label: 'C', lat: Number.NaN, lng: 75.8 },
      { n: 4, shopId: 'd', label: 'D', lat: 95, lng: 75.8 },
      { n: 5, shopId: 'e', label: 'E', lat: 22.7, lng: 200 },
    ];
    const view = mapPoints(origin, bad);
    expect(view.shown).toEqual(stops);
    expect(view.points).toHaveLength(3);
    expect(view.dropped).toBe(3);
  });

  it('falls back to the start alone when no stop can be drawn, never to an empty list', () => {
    expect(mapPoints(origin, []).points).toEqual([[22.7196, 75.8577]]);
    expect(mapPoints({ lat: Number.NaN, lng: 1 }, stops).points).toHaveLength(2);
  });
});

describe('the errand to continue', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  const row = (over: Partial<ErrandListItem>): ErrandListItem => ({
    id: 'e',
    state: 'WAITING_FOR_SHOPS',
    task: 'x',
    createdAt: '2026-10-16T11:50:00.000Z',
    expiresAt: '2026-10-16T12:05:00.000Z',
    ...over,
  });

  it('is active while it is not final and has not run out of time', () => {
    expect(isActiveErrand(row({}), now)).toBe(true);
    expect(isActiveErrand(row({ state: 'NEEDS_INPUT' }), now)).toBe(true);
    expect(isActiveErrand(row({ expiresAt: '2026-10-16T11:59:00.000Z' }), now)).toBe(false);
    for (const state of ['PLAN_READY', 'FAILED', 'EXPIRED', 'CANCELLED'] as const)
      expect(isActiveErrand(row({ state }), now), state).toBe(false);
  });

  it('picks the newest active errand, or a plan that became ready within a day', () => {
    const active = row({ id: 'a' });
    const ready = row({ id: 'r', state: 'PLAN_READY', createdAt: '2026-10-16T08:00:00.000Z' });
    expect(resumableErrand([ready, active], now)?.id).toBe('r');
    expect(resumableErrand([active, ready], now)?.id).toBe('a');
    expect(resumableErrand([], now)).toBeNull();
  });

  it('leaves out old plans and errands that ended without a plan', () => {
    const old = row({ id: 'o', state: 'PLAN_READY', createdAt: '2026-10-14T08:00:00.000Z' });
    const failed = row({ id: 'f', state: 'FAILED' });
    const cancelled = row({ id: 'c', state: 'CANCELLED' });
    expect(resumableErrand([old, failed, cancelled], now)).toBeNull();
  });
});
