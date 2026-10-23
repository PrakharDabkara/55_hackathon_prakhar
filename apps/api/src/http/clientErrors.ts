import { Router } from 'express';
import { z } from 'zod';
import { redactPrivateData } from '../modules/ai/index.js';
import { parse } from './errors.js';
import { isSafeRequestId } from './requestId.js';

/**
 * What a browser may tell us about a crash. Every field is a fixed, small one and nothing else is
 * accepted (strict): no user input, no ids of people, no headers. The per-IP and per-user limits
 * are in routeLimits.
 */
const reportSchema = z
  .object({
    message: z.string().min(1).max(300),
    stack: z.string().max(2048).optional(),
    route: z
      .string()
      .max(200)
      .regex(/^\/[^\s]*$/, 'must be a path')
      .optional(),
    appVersion: z
      .string()
      .regex(/^[\w.+-]{1,40}$/)
      .optional(),
    requestId: z.string().refine(isSafeRequestId, 'not a request id').optional(),
  })
  .strict();

/** `POST /client-errors`: the browser's window.onerror and unhandledrejection, logged at warn. */
export function clientErrorsRouter({ logger }: { logger: import('pino').Logger }): Router {
  const router = Router();
  router.post('/client-errors', (req, res) => {
    const report = parse(reportSchema, req.body);
    // Phones and emails in an error text are cut, as in every other log line.
    (req.log ?? logger).warn(
      {
        message: redactPrivateData(report.message),
        ...(report.stack && { stack: redactPrivateData(report.stack) }),
        ...(report.route && { route: redactPrivateData(report.route.split(/[?#]/)[0] ?? '') }),
        ...(report.appVersion && { appVersion: report.appVersion }),
        ...(report.requestId && { clientRequestId: report.requestId }),
      },
      'client error',
    );
    res.status(204).end();
  });
  return router;
}
