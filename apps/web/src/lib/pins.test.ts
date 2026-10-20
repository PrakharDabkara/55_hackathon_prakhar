import { describe, expect, it } from 'vitest';
import { pinHtml, pinsKey } from './pins.js';

describe('pinHtml (markers are drawn in CSS with tokens)', () => {
  it('is one span with a class per kind: no image files, no style attribute, no colour values', () => {
    for (const kind of ['user', 'live', 'learned'] as const) {
      const html = pinHtml(kind);
      expect(html).toBe(`<span class="cu-map-pin cu-map-pin--${kind}"></span>`);
      expect(html).not.toMatch(/style=|<img|url\(|#[0-9a-f]{3,6}/i);
    }
  });

  it('gives the user, a live answer and remembered stock three different looks', () => {
    expect(new Set(['user', 'live', 'learned'].map((k) => pinHtml(k as 'user'))).size).toBe(3);
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
