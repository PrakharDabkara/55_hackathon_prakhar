import { describe, expect, it } from 'vitest';
import { result } from '../test/fakes.js';
import { directionsUrl, pinsFor, sortResults } from './results.js';

describe('sortResults', () => {
  const a = result({ shopId: 'a', pricePaise: 6000, distanceM: 100 });
  const b = result({ shopId: 'b', pricePaise: 4000, distanceM: 900 });
  const c = result({ shopId: 'c', pricePaise: null, distanceM: 50 });

  it('by price puts the cheapest first and shops with no price last', () => {
    expect(sortResults([a, b, c], 'price').map((r) => r.shopId)).toEqual(['b', 'a', 'c']);
  });

  it('by distance puts the nearest first', () => {
    expect(sortResults([a, b, c], 'distance').map((r) => r.shopId)).toEqual(['c', 'a', 'b']);
  });

  it('breaks a price tie by distance, and leaves the input alone', () => {
    const input = [
      result({ shopId: 'far', pricePaise: 5000, distanceM: 800 }),
      result({ shopId: 'near', pricePaise: 5000, distanceM: 100 }),
    ];
    expect(sortResults(input, 'price').map((r) => r.shopId)).toEqual(['near', 'far']);
    expect(input.map((r) => r.shopId)).toEqual(['far', 'near']);
  });
});

describe('pinsFor', () => {
  it('makes one pin per shop: live answers green, learned stock blue', () => {
    const pins = pinsFor([
      result({ shopId: 'a', source: 'live', lat: 1, lng: 2, name: 'A' }),
      result({ shopId: 'b', source: 'learned', lat: 3, lng: 4, name: 'B' }),
    ]);
    expect(pins).toEqual([
      { id: 'a', lat: 1, lng: 2, kind: 'live', label: 'A' },
      { id: 'b', lat: 3, lng: 4, kind: 'learned', label: 'B' },
    ]);
  });
});

describe('directionsUrl', () => {
  it('opens Google Maps directions to the shop', () => {
    expect(directionsUrl(22.7196, 75.8577)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=22.7196,75.8577',
    );
  });
});
