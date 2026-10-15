import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { ZodType } from 'zod';

/** An error the client may see: `{"error":{"code","message"}}` with this status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields for the client, merged into the error object (for example a question and options). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Parses with a zod schema; failure becomes a 400 naming the fields, never their values. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
  throw new ApiError(400, 'invalid_request', problems.join('; '));
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, 'not_found', 'No such route'));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express recognises an error handler by its four parameters, so `_next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err, req, res, _next) => {
    if (err instanceof ApiError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, ...err.details } });
      return;
    }
    // body-parser errors (bad JSON, too large) carry a status and a type.
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = status === 413 ? 'payload_too_large' : 'invalid_request';
      res.status(status).json({ error: { code, message: 'Request body could not be read' } });
      return;
    }
    (req.log ?? logger).error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
  };
}
