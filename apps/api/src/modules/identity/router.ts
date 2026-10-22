import { Router } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { createIpLimiter, type IpLimitStore } from '../../http/ipLimit.js';
import { authOf, createRequireAuth } from './middleware.js';
import { maskPhone, normalisePhone } from './phone.js';
import { latestDevCode, requestOtp, revokeSession, verifyOtp } from './service.js';

interface IdentityDeps {
  db: Database;
  logger: Logger;
  otpMode: 'simulated';
  /** Phones that get a code in the demo inbox. Nobody else can read one (ADR-0058). */
  demoPhones: readonly string[];
  /** Tests only: every phone gets a code in the demo inbox. */
  inboxOpen: boolean;
  /** Most requests one IP may make per window to each route. */
  ipLimits: { request: number; verify: number; inbox: number };
  ipLimitStore: IpLimitStore;
}

export const IP_LIMIT_WINDOW_MS = 10 * 60_000;

// Longer than any phone number written with spaces, dashes and a country code; shorter than a body.
const phoneField = z
  .string()
  .max(32)
  .transform((raw, ctx) => {
    const phone = normalisePhone(raw);
    if (!phone) ctx.addIssue({ code: 'custom', message: 'must be an Indian mobile number' });
    return phone ?? z.NEVER;
  });

const requestBody = z.strictObject({ phone: phoneField });
const verifyBody = z.strictObject({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  role: z.enum(['seeker', 'shop']),
});
const inboxQuery = z.strictObject({ phone: phoneField });

export function identityRouter({
  db,
  logger,
  otpMode,
  demoPhones,
  inboxOpen,
  ipLimits,
  ipLimitStore: store,
}: IdentityDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(db);
  const limit = (name: keyof typeof ipLimits) =>
    createIpLimiter({ name, max: ipLimits[name], windowMs: IP_LIMIT_WINDOW_MS, store });
  // Only these phones can have a readable code. Every other number still gets the same 202 and a
  // hashed code, so nothing tells a stranger whether it is a demo number or has an account.
  const codeIsReadable = (phone: string) => inboxOpen || demoPhones.includes(phone);

  router.post('/auth/otp/request', limit('request'), async (req, res) => {
    const { phone } = parse(requestBody, req.body);
    const log = req.log ?? logger;
    const stored = await requestOtp(db, phone, {
      keepPlainCode: otpMode === 'simulated' && codeIsReadable(phone),
    });
    if (!stored) {
      log.warn({ phoneMasked: maskPhone(phone) }, 'otp request rate limited');
      throw new ApiError(
        429,
        'rate_limited',
        'Too many codes requested. Try again in a few minutes',
      );
    }
    log.info({ phoneMasked: maskPhone(phone) }, 'otp requested');
    res.status(202).json({});
  });

  router.post('/auth/otp/verify', limit('verify'), async (req, res) => {
    const { phone, code, role } = parse(verifyBody, req.body);
    const log = req.log ?? logger;
    const result = await verifyOtp(db, phone, code, role);
    if (!result) {
      log.info({ phoneMasked: maskPhone(phone) }, 'otp verification failed');
      throw new ApiError(401, 'invalid_code', 'That code is wrong, expired or already used');
    }
    log.info(
      { phoneMasked: maskPhone(phone), userId: result.user.id, role: result.user.role },
      'login',
    );
    res.json(result);
  });

  router.post('/auth/logout', requireAuth, async (req, res) => {
    const { sessionId, user } = authOf(req);
    await revokeSession(db, sessionId);
    (req.log ?? logger).info({ userId: user.id }, 'logout');
    res.status(204).end();
  });

  // Demo only: there is no SMS, so the code is read here. Never mounted in any other mode.
  if (otpMode === 'simulated') {
    router.get('/dev/otp-inbox', limit('inbox'), async (req, res) => {
      const { phone } = parse(inboxQuery, req.query);
      // Also checked here: a code stored before the allowlist existed must stay unreadable.
      const code = codeIsReadable(phone) ? await latestDevCode(db, phone) : null;
      if (!code) throw new ApiError(404, 'not_found', 'No unexpired code for that phone');
      res.json({ code });
    });
  }

  return router;
}
