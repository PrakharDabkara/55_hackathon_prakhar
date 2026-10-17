import { describe, expect, it } from 'vitest';
import { directionsForRoute, shownProgress, stopsForMap } from './errand.js';

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
