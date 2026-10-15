import { describe, expect, it } from 'vitest';
import { PIN_COLOURS, pinSvg } from './pins.js';

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
