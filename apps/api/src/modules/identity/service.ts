import type { Role } from '@kahanmilega/shared';
import type { Queryable } from '../../db/queryable.js';
import {
  MAX_ATTEMPTS,
  MAX_REQUESTS,
  OTP_TTL_MS,
  REQUEST_WINDOW_MS,
  generateOtp,
  hashOtp,
  matchesOtp,
  otpStatus,
} from './otp.js';
import { generateToken, hashToken } from './tokens.js';
import type { AuthContext, User } from './types.js';

export const SESSION_TTL_DAYS = 30;

interface OtpRow {
  id: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
}

/** Stores a fresh code, or returns null when the phone already asked 3 times in 10 minutes. */
export async function requestOtp(
  db: Queryable,
  phone: string,
  opts: { keepPlainCode: boolean },
): Promise<boolean> {
  const code = generateOtp();
  // Count and insert in one statement, so concurrent requests cannot both slip under the limit.
  const { rowCount } = await db.query(
    `INSERT INTO otp_codes (phone, code_hash, dev_code, expires_at)
     SELECT $1::text, $2, $3, now() + make_interval(secs => $4::double precision)
      WHERE (SELECT count(*) FROM otp_codes
              WHERE phone = $1::text
                AND created_at > now() - make_interval(secs => $5::double precision)) < $6`,
    [
      phone,
      hashOtp(phone, code),
      opts.keepPlainCode ? code : null,
      OTP_TTL_MS / 1000,
      REQUEST_WINDOW_MS / 1000,
      MAX_REQUESTS,
    ],
  );
  return rowCount === 1;
}

/** The newest unexpired, unused code for the demo inbox, or null. */
export async function latestDevCode(db: Queryable, phone: string): Promise<string | null> {
  const { rows } = await db.query<{ dev_code: string }>(
    `SELECT dev_code FROM otp_codes
      WHERE phone = $1 AND dev_code IS NOT NULL AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [phone],
  );
  return rows[0]?.dev_code ?? null;
}

/** Checks the newest code for the phone. Every failure looks the same to the caller. */
async function consumeOtp(db: Queryable, phone: string, code: string): Promise<boolean> {
  const { rows } = await db.query<OtpRow>(
    `SELECT id, code_hash, expires_at, attempts, consumed_at FROM otp_codes
      WHERE phone = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [phone],
  );
  const otp = rows[0];
  if (!otp) return false;
  if (
    otpStatus(
      { expiresAt: otp.expires_at, attempts: otp.attempts, consumedAt: otp.consumed_at },
      new Date(),
    ) !== 'ok'
  ) {
    return false;
  }
  // Count the attempt before comparing, atomically, so parallel guesses cannot exceed the limit.
  const counted = await db.query(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL AND expires_at > now()`,
    [otp.id, MAX_ATTEMPTS],
  );
  if (counted.rowCount !== 1) return false;
  if (!matchesOtp(phone, code, otp.code_hash)) return false;
  // Single use: only one concurrent caller wins this update.
  const used = await db.query(
    `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [otp.id],
  );
  return used.rowCount === 1;
}

export interface LoginResult {
  token: string;
  user: User;
}

/** Verifies the code and opens a session. Returns null for any bad, expired, used or locked code. */
export async function verifyOtp(
  db: Queryable,
  phone: string,
  code: string,
  role: Extract<Role, 'seeker' | 'shop'>,
): Promise<LoginResult | null> {
  if (!(await consumeOtp(db, phone, code))) return null;

  // First login creates the user with the requested role; later logins keep the stored role.
  const { rows } = await db.query<User>(
    `INSERT INTO users (phone, role) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING id, phone, role`,
    [phone, role],
  );
  const user = rows[0] as User;

  const token = generateToken();
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3::int))`,
    [hashToken(token), user.id, SESSION_TTL_DAYS],
  );
  return { token, user };
}

/** The live session behind a bearer token, or null if unknown, revoked or expired. */
export async function authenticate(db: Queryable, token: string): Promise<AuthContext | null> {
  const { rows } = await db.query<{ session_id: string; id: string; phone: string; role: Role }>(
    `SELECT s.id AS session_id, u.id, u.phone, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row
    ? { sessionId: row.session_id, user: { id: row.id, phone: row.phone, role: row.role } }
    : null;
}

export async function revokeSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
    sessionId,
  ]);
}
