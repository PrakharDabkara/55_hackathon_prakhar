import { describe, expect, it } from 'vitest';
import { cleanNote } from './note.js';

describe('the order note (≤140, phone numbers removed)', () => {
  it('keeps plain words', () => {
    expect(cleanNote('Ring the bell twice')).toBe('Ring the bell twice');
  });
  it('removes phone numbers with the privacy regex', () => {
    expect(cleanNote('call me on +91 98765 43210 please')).not.toMatch(/\d{5}/);
    expect(cleanNote('9876543210')).toBeNull();
  });
  it('collapses whitespace, strips control characters and cuts at 140', () => {
    expect(cleanNote('a\n\tb')).toBe('a b');
    expect(cleanNote('x'.repeat(300))).toHaveLength(140);
  });
  it('is null for empty or missing', () => {
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote('   ')).toBeNull();
  });
});
