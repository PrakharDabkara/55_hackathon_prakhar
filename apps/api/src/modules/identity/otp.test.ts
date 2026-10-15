import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, OTP_TTL_MS, generateOtp, hashOtp, matchesOtp, otpStatus } from './otp.js';

const now = new Date('2026-10-15T10:00:00Z');
const live = {
  expiresAt: new Date(now.getTime() + 60_000),
  attempts: 0,
  consumedAt: null,
};

describe('generateOtp', () => {
  it('is always 6 digits, including leading zeros', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
});

describe('hashOtp / matchesOtp', () => {
  it('matches the right code for the right phone only', () => {
    const hash = hashOtp('+919876543210', '123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
    expect(matchesOtp('+919876543210', '123456', hash)).toBe(true);
    expect(matchesOtp('+919876543210', '123457', hash)).toBe(false);
    expect(matchesOtp('+919999999999', '123456', hash)).toBe(false);
  });
});

describe('otpStatus', () => {
  it('lives for 5 minutes', () => {
    expect(OTP_TTL_MS).toBe(5 * 60_000);
  });

  it('is ok while unexpired, unused and under the attempt limit', () => {
    expect(otpStatus(live, now)).toBe('ok');
    expect(otpStatus({ ...live, attempts: MAX_ATTEMPTS - 1 }, now)).toBe('ok');
  });

  it('is expired at and after expiry', () => {
    expect(otpStatus({ ...live, expiresAt: now }, now)).toBe('expired');
  });

  it('is used once consumed', () => {
    expect(otpStatus({ ...live, consumedAt: now }, now)).toBe('used');
  });

  it('is locked after 5 attempts', () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(otpStatus({ ...live, attempts: 5 }, now)).toBe('locked');
  });
});
