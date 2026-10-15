import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_REQUESTS = 3;
export const REQUEST_WINDOW_MS = 10 * 60_000;

/** Six digits, leading zeros kept. */
export const generateOtp = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

/** Bound to the phone, so a hash from one number never matches another. */
export const hashOtp = (phone: string, code: string): string =>
  createHash('sha256').update(`${phone}:${code}`).digest('hex');

export function matchesOtp(phone: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(phone, code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface OtpRecord {
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type OtpStatus = 'ok' | 'expired' | 'used' | 'locked';

export function otpStatus(otp: OtpRecord, now: Date): OtpStatus {
  if (otp.consumedAt) return 'used';
  if (otp.expiresAt <= now) return 'expired';
  if (otp.attempts >= MAX_ATTEMPTS) return 'locked';
  return 'ok';
}
