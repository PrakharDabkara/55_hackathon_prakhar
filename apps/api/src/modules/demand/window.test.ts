import { describe, expect, it } from 'vitest';
import { parseDays } from './window.js';

describe('the demand window (?days=)', () => {
  it('is 1 when left out', () => {
    expect(parseDays(undefined)).toBe(1);
  });
  it('accepts 1 and 7', () => {
    expect(parseDays('1')).toBe(1);
    expect(parseDays('7')).toBe(7);
  });
  it.each(['0', '2', '30', '-1', '1.5', 'abc', '', '7 ', ' 1', '07', ['1', '7']])(
    'refuses %j with a 400',
    (value) => {
      expect(() => parseDays(value)).toThrowError(expect.objectContaining({ status: 400 }));
    },
  );
});
