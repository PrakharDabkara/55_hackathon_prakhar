import type { Role } from '@kahanmilega/shared';
import type { Request, RequestHandler } from 'express';
import type { Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { authenticate } from './service.js';
import type { AuthContext } from './types.js';

/** 401 unless the request carries a live bearer token; sets `req.auth`. */
export function createRequireAuth(db: Queryable): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer (\S+)$/.exec(header);
    const auth = match?.[1] ? await authenticate(db, match[1]) : null;
    if (!auth) throw new ApiError(401, 'unauthorized', 'Log in to continue');
    req.auth = auth;
    next();
  };
}

/** 403 unless the logged-in user has one of the roles. Use after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new ApiError(401, 'unauthorized', 'Log in to continue');
    if (!roles.includes(req.auth.user.role)) {
      throw new ApiError(403, 'forbidden', 'This action is not available for your role');
    }
    next();
  };
}

/** The caller behind a request that passed requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new ApiError(401, 'unauthorized', 'Log in to continue');
  return req.auth;
}
