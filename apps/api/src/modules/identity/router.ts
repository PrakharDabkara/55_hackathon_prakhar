import { Router } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Database } from '../../db/queryable.js';
import { ApiError, parse } from '../../http/errors.js';
import { createIpLimiter, type IpLimitStore } from '../../http/ipLimit.js';
import type { KeyDiag } from '../../http/limiterDiag.js';
import { authOf, createRequireAuth } from './middleware.js';
import { maskPhone, normalisePhone } from './phone.js';
import { attemptsLeft, latestDevCode, requestOtp, revokeSession, verifyOtp } from './service.js';

interface IdentityDeps {
  db: Database;
  logger: Logger;
  otpMode: 'simulated';
  /** Phones that get a code in the demo inbox. Nobody else can read one (ADR-0058). */
  demoPhones: readonly string[];
  /** The subset of `demoPhones` the login screens may show, per role. Nothing else is ever served. */
  publicDemoPhones: { shop: readonly string[]; seeker: readonly string[] };
  /** Tests only: every phone gets a code in the demo inbox. */
  inboxOpen: boolean;
  /** Most requests one IP may make per window to each route. */
  ipLimits: { request: number; verify: number; inbox: number };
  ipLimitStore: IpLimitStore;
  /** Temporary: logs the hashed limiter key of each sign-in request (LIMITER_DIAG). */
  keyDiag?: KeyDiag | undefined;
}

const INDIAN_MOBILE_MESSAGE = "That doesn't look like an Indian mobile number.";

export const IP_LIMIT_WINDOW_MS = 10 * 60_000;

// Longer than any phone number written with spaces, dashes and a country code; shorter than a body.
const phoneField = z
  .string()
  .max(32)
  .transform((raw, ctx) => {
    const phone = normalisePhone(raw);
    if (!phone) ctx.addIssue({ code: 'custom', message: INDIAN_MOBILE_MESSAGE });
    return phone ?? z.NEVER;
  });

const requestBody = z.strictObject({ phone: phoneField });
const verifyBody = z.strictObject({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
  role: z.enum(['seeker', 'shop']),
});
const inboxQuery = z.strictObject({ phone: phoneField });
const demoNumbersQuery = z.strictObject({ role: z.enum(['seeker', 'shop']) });

export function identityRouter({
  db,
  logger,
  otpMode,
  demoPhones,
  publicDemoPhones,
  inboxOpen,
  ipLimits,
  ipLimitStore: store,
  keyDiag: diag,
}: IdentityDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(db);
  const limit = (name: keyof typeof ipLimits) =>
    createIpLimiter({ name, max: ipLimits[name], windowMs: IP_LIMIT_WINDOW_MS, store, diag });
  // Its own bucket, same size as the inbox's: a room of people loading the login screens must not
  // use up the budget of "Fill the code".
  const demoNumbersLimit = createIpLimiter({
    name: 'demo-numbers',
    max: ipLimits.inbox,
    windowMs: IP_LIMIT_WINDOW_MS,
    store,
    diag,
  });
  // Only these phones can have a readable code. Every other number still gets the same 202 and a
  // hashed code, so nothing tells a stranger whether it is a demo number or has an account.
  const codeIsReadable = (phone: string) => inboxOpen || demoPhones.includes(phone);

  router.post('/auth/otp/request', limit('request'), async (req, res) => {
    const { phone } = parse(requestBody, req.body);
    const log = req.log ?? logger;
    // No SMS exists (ADR-0013): a number that cannot read its code gets told so now, not after a
    // code screen it can never finish. It costs no code row. This does tell a caller whether a
    // number is on the demo list (ADR-0066); the list is 9000000xxx and its codes are open anyway.
    if (otpMode === 'simulated' && !codeIsReadable(phone)) {
      log.info({ phoneMasked: maskPhone(phone) }, 'otp refused: demo mode');
      throw new ApiError(
        403,
        'demo_mode',
        "AskBuy is in demo mode. Real numbers can't receive codes yet.",
      );
    }
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
      // Only where the code is readable anyway (demo numbers): elsewhere the count would tell a
      // stranger whether a person is mid-login.
      const left = codeIsReadable(phone) ? await attemptsLeft(db, phone) : null;
      throw new ApiError(
        401,
        'invalid_code',
        'That code is wrong, expired or already used',
        left === null ? {} : { attemptsLeft: left },
      );
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

  // The numbers the login screens offer as chips: public ones only, for the asked role, no login.
  router.get('/auth/demo-numbers', demoNumbersLimit, (req, res) => {
    const { role } = parse(demoNumbersQuery, req.query);
    res.json({
      demo: otpMode === 'simulated',
      numbers: publicDemoPhones[role].map((phone) => phone.slice(3)),
    });
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
