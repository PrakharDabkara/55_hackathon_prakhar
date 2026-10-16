import { describe, expect, it } from 'vitest';
import { PIN_COLOURS, pinSvg, pinsKey } from './pins.js';

describe('pinSvg', () => {
  it('is inline SVG: no image files, no style attribute (the CSP forbids inline style)', () => {
    for (const kind of ['user', 'live', 'learned'] as const) {
      const svg = pinSvg(kind);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/style=/i);
      expect(svg).not.toMatch(/<img|url\(|href=/i);
    }
  });

  it('colours live answers green, learned stock blue, and the user differently from both', () => {
    expect(PIN_COLOURS.live).toMatch(/^#/);
    expect(new Set(Object.values(PIN_COLOURS)).size).toBe(3);
    expect(pinSvg('live')).toContain(PIN_COLOURS.live);
    expect(pinSvg('learned')).toContain(PIN_COLOURS.learned);
    expect(pinSvg('learned')).not.toContain(PIN_COLOURS.live);
  });

  it('names green as green and blue as blue', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
      return g > r && g > b ? 'green' : b > r && b > g ? 'blue' : 'other';
    };
    expect(hue(PIN_COLOURS.live)).toBe('green');
    expect(hue(PIN_COLOURS.learned)).toBe('blue');
  });
});

describe('pinsKey (the map refits when this changes)', () => {
  const pin = (
    id: string,
    over: Partial<{ kind: 'live' | 'learned'; lat: number; lng: number }> = {},
  ) => ({
    id,
    kind: 'live' as const,
    lat: 22.7,
    lng: 75.8,
    ...over,
  });

  it('ignores the order of the pins', () => {
    expect(pinsKey([pin('a'), pin('b')])).toBe(pinsKey([pin('b'), pin('a')]));
  });

  it('changes when a shop is added, so a newly answered shop is brought into view', () => {
    expect(pinsKey([pin('a')])).not.toBe(pinsKey([pin('a'), pin('b')]));
  });

  it('changes when a pin turns from learned stock into a live answer, or moves', () => {
    expect(pinsKey([pin('a', { kind: 'learned' })])).not.toBe(pinsKey([pin('a')]));
    expect(pinsKey([pin('a')])).not.toBe(pinsKey([pin('a', { lat: 22.71 })]));
  });
});
