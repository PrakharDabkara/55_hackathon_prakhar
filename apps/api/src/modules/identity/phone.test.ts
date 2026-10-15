import { describe, expect, it } from 'vitest';
import { maskPhone, normalisePhone } from './phone.js';

describe('normalisePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    [' 98765 43210 ', '+919876543210'],
  ])('accepts %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each(['', '12345', '5876543210', '98765432101', '+14155550123', 'abcdefghij', '+9198765'])(
    'rejects %s',
    (raw) => {
      expect(normalisePhone(raw)).toBeNull();
    },
  );
});

describe('maskPhone', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+919876543210')).toBe('******3210');
  });
});
