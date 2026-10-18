import { describe, expect, it } from 'vitest';
import { directionsForRoute, mapPoints, shownProgress, stopsForMap } from './errand.js';

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

describe('shownProgress', () => {
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
