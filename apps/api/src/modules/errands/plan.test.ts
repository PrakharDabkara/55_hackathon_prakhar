import { describe, expect, it } from 'vitest';
import { previousAnswerLabel } from './plan.js';

const HOUR = 3_600_000;
const now = new Date('2026-10-17T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('previousAnswerLabel (learned stock is a remembered answer, never "Confirmed")', () => {
  it('says aaj within a day, kal for the next, then N din pehle', () => {
    expect(previousAnswerLabel(ago(5 * 60_000), now)).toBe('Last answer: today');
    expect(previousAnswerLabel(ago(23 * HOUR), now)).toBe('Last answer: today');
    expect(previousAnswerLabel(ago(25 * HOUR), now)).toBe('Last answer: yesterday');
    expect(previousAnswerLabel(ago(49 * HOUR), now)).toBe('Last answer: 2 days ago');
    expect(previousAnswerLabel(ago(6 * 24 * HOUR), now)).toBe('Last answer: 6 days ago');
  });

  it('treats a timestamp slightly in the future as today', () => {
    expect(previousAnswerLabel(new Date(now.getTime() + 60_000), now)).toBe('Last answer: today');
  });
});
