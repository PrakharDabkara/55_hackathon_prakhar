import { describe, expect, it } from 'vitest';
import { phoneFeatures } from './phoneWindows.js';

describe('phoneFeatures', () => {
  it('centres one phone window', () => {
    expect(phoneFeatures(1, { width: 1920, height: 1080 })).toEqual([
      'width=420,height=860,left=750,top=110',
    ]);
  });

  it('puts two windows side by side with a gap, on one top', () => {
    const [a, b] = phoneFeatures(2, { width: 1920, height: 1080 });
    expect(a).toBe('width=420,height=860,left=532,top=110');
    expect(b).toBe('width=420,height=860,left=968,top=110');
  });

  it('shrinks to a short screen and never goes off the left or top edge', () => {
    const [a, b] = phoneFeatures(2, { width: 800, height: 700 });
    expect(a).toBe('width=420,height=700,left=0,top=0');
    expect(b).toBe('width=420,height=700,left=436,top=0');
  });
});
