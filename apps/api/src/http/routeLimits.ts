import type { Request, RequestHandler } from 'express';
import { enforceLimit, ipKey, type IpLimitStore } from './ipLimit.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface RouteRule {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The exact path (no parameters): the dear routes have none. */
  path: string;
  name: string;
  /** Most calls one signed-in user may make in the window; every call counts, refused or not. */
  perUser?: number;
  /** Most calls one IP may make in the window, whoever is signed in. */
  perIp?: number;
  windowMs: number;
}

/**
 * The routes that cost something (a model call, an embedding, a database write with a side effect)
 * and how often one caller may use them (ADR-0059). The errand and list hourly limits live in their
 * services and stay as they are.
 */
/** The rules with every number times `scale` (1 in production). */
export const scaleRules = (rules: RouteRule[], scale: number): RouteRule[] =>
  rules.map((r) => ({
    ...r,
    ...(r.perUser !== undefined && { perUser: Math.max(1, Math.ceil(r.perUser * scale)) }),
    ...(r.perIp !== undefined && { perIp: Math.max(1, Math.ceil(r.perIp * scale)) }),
  }));

export const ROUTE_RULES: RouteRule[] = [
  { method: 'GET', path: '/search', name: 'search', perUser: 30, perIp: 60, windowMs: MINUTE_MS },
  {
    method: 'POST',
    path: '/items/resolve',
    name: 'resolve',
    perUser: 30,
    perIp: 60,
    windowMs: MINUTE_MS,
  },
  { method: 'POST', path: '/lists/sort', name: 'sort', perUser: 10, windowMs: MINUTE_MS },
  { method: 'POST', path: '/route/plan', name: 'plan', perUser: 20, windowMs: MINUTE_MS },
  { method: 'POST', path: '/requests', name: 'ask', perUser: 20, windowMs: HOUR_MS },
  { method: 'POST', path: '/photos', name: 'photo', perUser: 20, windowMs: HOUR_MS },
];

/** Express matches paths without case and with or without a trailing slash; so must the rules. */
const canonical = (path: string) =>
  (path.length > 1 ? path.replace(/\/+$/, '') : path).toLowerCase();

/**
 * Applies `rules` before the routes run. It works out who is calling (`identify`), so the limit is
 * per user and a fresh login does not reset it; an anonymous call is limited by its IP alone.
 */
export function createRouteLimits({
  rules,
  store,
  identify,
}: {
  rules: RouteRule[];
  store: IpLimitStore;
  /** The signed-in user's id, or null. Must not throw. */
  identify: (req: Request) => Promise<string | null>;
}): RequestHandler {
  const byRoute = new Map(rules.map((r) => [`${r.method} ${canonical(r.path)}`, r]));
  return async (req, res, next) => {
    const rule = byRoute.get(`${req.method} ${canonical(req.path)}`);
    if (!rule) {
      next();
      return;
    }
    const { name, windowMs } = rule;
    if (rule.perIp !== undefined) {
      await enforceLimit(res, store, `rl:${name}:ip:${ipKey(req.ip)}`, {
        max: rule.perIp,
        windowMs,
      });
    }
    if (rule.perUser !== undefined) {
      const userId = await identify(req);
      // No user: the IP counter above is the limit. (Without a per-IP number an anonymous call
      // is refused by the route itself, with a 401, before it can cost anything.)
      if (userId)
        await enforceLimit(res, store, `rl:${name}:u:${userId}`, { max: rule.perUser, windowMs });
    }
    next();
  };
}
