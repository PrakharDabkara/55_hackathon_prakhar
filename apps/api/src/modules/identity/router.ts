import { Router } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { authOf, createRequireAuth } from './middleware.js';
import { maskPhone, normalisePhone } from './phone.js';
import { latestDevCode, requestOtp, revokeSession, verifyOtp } from './service.js';

interface IdentityDeps {
  db: Database;
  logger: Logger;
  otpMode: 'simulated';
  /** Phones that become admin on login. */
  adminPhones?: readonly string[];
}

const phoneField = z.string().transform((raw, ctx) => {
  const phone = normalisePhone(raw);
  if (!phone) ctx.addIssue({ code: 'custom', message: 'must be an Indian mobile number' });
  return phone ?? z.NEVER;
});

const requestBody = z.object({ phone: phoneField });
const verifyBody = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  role: z.enum(['seeker', 'shop']),
});
const inboxQuery = z.object({ phone: phoneField });

export function identityRouter({ db, logger, otpMode, adminPhones = [] }: IdentityDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(db);

  router.post('/auth/otp/request', async (req, res) => {
    const { phone } = parse(requestBody, req.body);
    const log = req.log ?? logger;
    const stored = await requestOtp(db, phone, { keepPlainCode: otpMode === 'simulated' });
    if (!stored) {
      log.warn({ phone: maskPhone(phone) }, 'otp request rate limited');
      throw new ApiError(
        429,
        'rate_limited',
        'Too many codes requested. Try again in a few minutes',
      );
    }
    log.info({ phone: maskPhone(phone) }, 'otp requested');
    res.status(202).json({});
  });

  router.post('/auth/otp/verify', async (req, res) => {
    const { phone, code, role } = parse(verifyBody, req.body);
    const log = req.log ?? logger;
    const result = await verifyOtp(db, phone, code, role, adminPhones);
    if (!result) {
      log.info({ phone: maskPhone(phone) }, 'otp verification failed');
      throw new ApiError(401, 'invalid_code', 'That code is wrong, expired or already used');
    }
    log.info({ phone: maskPhone(phone), userId: result.user.id, role: result.user.role }, 'login');
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
    router.get('/dev/otp-inbox', async (req, res) => {
      const { phone } = parse(inboxQuery, req.query);
      const code = await latestDevCode(db, phone);
      if (!code) throw new ApiError(404, 'not_found', 'No unexpired code for that phone');
      res.json({ code });
    });
  }

  return router;
}
