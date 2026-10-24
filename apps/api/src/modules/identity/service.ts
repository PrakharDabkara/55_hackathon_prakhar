import type { Role } from '@askbuy/shared';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
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

/** Stores a fresh code, or returns false when the phone already asked 3 times in 10 minutes. */
export async function requestOtp(
  db: Database,
  phone: string,
  opts: { keepPlainCode: boolean },
): Promise<boolean> {
  const code = generateOtp();
  return withTransaction(db, async (tx) => {
    // Under READ COMMITTED, concurrent count-then-insert statements cannot see each other's
    // uncommitted rows. The per-phone advisory lock makes them take turns; it frees at commit.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [phone]);
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_codes
        WHERE phone = $1 AND created_at > now() - make_interval(secs => $2::double precision)`,
      [phone, REQUEST_WINDOW_MS / 1000],
    );
    if ((rows[0]?.n ?? 0) >= MAX_REQUESTS) return false;
    await tx.query(
      `INSERT INTO otp_codes (phone, code_hash, dev_code, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision))`,
      [phone, hashOtp(phone, code), opts.keepPlainCode ? code : null, OTP_TTL_MS / 1000],
    );
    return true;
  });
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
  // Count the attempt before comparing. One guarded UPDATE: Postgres re-checks `attempts < 5` on the
  // row after waiting for a concurrent update, so parallel guesses cannot exceed the limit.
  const counted = await db.query(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL AND expires_at > now()
      RETURNING attempts`,
    [otp.id, MAX_ATTEMPTS],
  );
  if (counted.rows.length !== 1) return false;
  if (!matchesOtp(phone, code, otp.code_hash)) return false;
  // Single use: only one concurrent caller wins this update.
  const used = await db.query(
    `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [otp.id],
  );
  return used.rowCount === 1;
}

/**
 * Tries left on the newest code after a wrong guess (0 once it is locked), or null when there is no
 * live code to count (none asked, expired or used). Only called after a failed verify.
 */
export async function attemptsLeft(db: Queryable, phone: string): Promise<number | null> {
  const { rows } = await db.query<OtpRow>(
    `SELECT id, code_hash, expires_at, attempts, consumed_at FROM otp_codes
      WHERE phone = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [phone],
  );
  const otp = rows[0];
  if (!otp) return null;
  const status = otpStatus(
    { expiresAt: otp.expires_at, attempts: otp.attempts, consumedAt: otp.consumed_at },
    new Date(),
  );
  return status === 'ok' || status === 'locked' ? Math.max(0, MAX_ATTEMPTS - otp.attempts) : null;
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

  // First login creates the user with the requested role; later logins keep the stored role. A
  // phone login never makes an admin: admin is the ADMIN_TOKEN, not a user (ADR-0058).
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

/** Ends every live session of the user (log out on all devices). Returns how many there were. */
export async function revokeAllSessions(db: Queryable, userId: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return rowCount ?? 0;
}

/** Whether the user can still be logged in somewhere: used before an event stream is opened. */
export async function hasLiveSession(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

export interface NewUserSession {
  userId: string;
  phone: string;
  token: string;
}

/**
 * Creates shop users with a session each in two statements, for the simulator. Returns null,
 * creating nothing, if any phone already has a user.
 */
export async function createShopUsers(
  db: Queryable,
  phones: string[],
  options: { demo?: boolean } = {},
): Promise<NewUserSession[] | null> {
  const users = await db.query<{ id: string; phone: string }>(
    `INSERT INTO users (phone, role, is_demo) SELECT unnest($1::text[]), 'shop', $2::boolean
     ON CONFLICT (phone) DO NOTHING RETURNING id, phone`,
    [phones, options.demo === true],
  );
  if (users.rows.length !== phones.length) return null;
  const tokens = users.rows.map(() => generateToken());
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     SELECT h, u, now() + make_interval(days => $3::int)
       FROM unnest($1::text[], $2::uuid[]) AS t(h, u)`,
    [tokens.map(hashToken), users.rows.map((u) => u.id), SESSION_TTL_DAYS],
  );
  const byPhone = new Map(
    users.rows.map((u, i) => [u.phone, { id: u.id, token: tokens[i] as string }]),
  );
  return phones.map((phone) => {
    const hit = byPhone.get(phone) as { id: string; token: string };
    return { userId: hit.id, phone, token: hit.token };
  });
}

/**
 * The user behind a demo phone (ADR-0062), made if missing and marked is_demo. A demo number only
 * ever belongs to the demo, so its role is set to what the demo needs it to be.
 */
export async function ensureDemoUser(
  db: Queryable,
  phone: string,
  role: 'seeker' | 'shop',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (phone, role, is_demo) VALUES ($1, $2, true)
     ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role, is_demo = true
     RETURNING id`,
    [phone, role],
  );
  return (rows[0] as { id: string }).id;
}

/** The ids of the users who have any of these phones. */
export async function findUserIdsByPhones(db: Queryable, phones: string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = ANY($1::text[])`,
    [phones],
  );
  return rows.map((r) => r.id);
}

export async function deleteUsers(db: Queryable, userIds: string[]): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  return rowCount ?? 0;
}

/** Locks a live (not deleted) user's row until the transaction ends. False if there is none. */
export async function lockLiveUser(tx: Queryable, userId: string): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Soft delete (ADR-0054): ends every session, erases the phone and marks the row deleted. The row
 * stays so requests and orders keep a user to point at; the same phone can register again as a
 * new row. Run inside the caller's transaction.
 */
export async function anonymiseUser(tx: Queryable, userId: string): Promise<void> {
  await tx.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await tx.query(`UPDATE users SET phone = NULL, deleted_at = now() WHERE id = $1`, [userId]);
}

/** The caller's own phone, or null. */
export async function phoneOf(db: Queryable, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ phone: string | null }>(
    `SELECT phone FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.phone ?? null;
}
