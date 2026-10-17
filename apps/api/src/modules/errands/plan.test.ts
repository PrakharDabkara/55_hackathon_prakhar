import { describe, expect, it } from 'vitest';
import { previousAnswerLabel } from './plan.js';

const HOUR = 3_600_000;
const now = new Date('2026-10-17T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('previousAnswerLabel (learned stock is a remembered answer, never "Confirmed")', () => {
  it('says aaj within a day, kal for the next, then N din pehle', () => {
    expect(previousAnswerLabel(ago(5 * 60_000), now)).toBe('Pichhla jawab: aaj');
    expect(previousAnswerLabel(ago(23 * HOUR), now)).toBe('Pichhla jawab: aaj');
    expect(previousAnswerLabel(ago(25 * HOUR), now)).toBe('Pichhla jawab: kal');
    expect(previousAnswerLabel(ago(49 * HOUR), now)).toBe('Pichhla jawab: 2 din pehle');
    expect(previousAnswerLabel(ago(6 * 24 * HOUR), now)).toBe('Pichhla jawab: 6 din pehle');
  });

  it('treats a timestamp slightly in the future as today', () => {
    expect(previousAnswerLabel(new Date(now.getTime() + 60_000), now)).toBe('Pichhla jawab: aaj');
  });
});
