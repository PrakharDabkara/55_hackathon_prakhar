import { describe, expect, it } from 'vitest';
import { indianMobile } from './phone.js';

describe('indianMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['9000000101', '9000000101'],
  ])('accepts %s', (raw, digits) => {
    expect(indianMobile(raw)).toBe(digits);
  });

  it.each(['', '12345', '5876543210', '98765432101', '+14155550123', 'abcdefghij'])(
    'rejects %s',
    (raw) => {
      expect(indianMobile(raw)).toBeNull();
    },
  );

  it.each(['9999999999', '+916666666666', '07777777777', '8888888888'])(
    'rejects the all-same-digit number %s',
    (raw) => {
      expect(indianMobile(raw)).toBeNull();
    },
  );
});
