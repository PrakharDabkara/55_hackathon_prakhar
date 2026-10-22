import type { RequestHandler, Response } from 'express';
import { isIPv6 } from 'node:net';
import { withTimeout } from '../workers/redis.js';
import { ApiError } from './errors.js';

export interface IpHit {
  /** Requests from this key in the current window, this one included. */
  count: number;
  retryAfterMs: number;
}

export interface IpLimitStore {
  hit(key: string, windowMs: number): Promise<IpHit>;
}

/** The one Redis command the store needs. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** One bucket per client. An IPv6 client owns a whole /64, so rotating inside it gains nothing. */
export function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const bare = ip.split('%')[0] ?? ip;
  if (!isIPv6(bare)) return ip;
  const [head = '', tail] = bare.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? first
      : [
          ...first,
          ...Array<string>(Math.max(8 - first.length - last.length, 0)).fill('0'),
          ...last,
        ];
  return groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':');
}

interface MemoryStore extends IpLimitStore {
  size(): number;
}

/**
 * Fixed windows in this process. The fallback when Redis is away, and the store when there is no
 * Redis. Bounded: past `maxKeys` the oldest keys are dropped, which takes that many distinct
 * addresses to abuse.
 */
export function createMemoryStore({
  now = Date.now,
  maxKeys = 50_000,
}: { now?: () => number; maxKeys?: number } = {}): MemoryStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    size: () => windows.size,
    async hit(key, windowMs) {
      const at = now();
      const live = windows.get(key);
      const entry = live && live.resetAt > at ? live : { count: 0, resetAt: at + windowMs };
      entry.count += 1;
      // Delete first, so the key moves to the end of the insertion order (the newest).
      windows.delete(key);
      windows.set(key, entry);
      while (windows.size > maxKeys) {
        const oldest = windows.keys().next().value;
        if (oldest === undefined) break;
        windows.delete(oldest);
      }
      return { count: entry.count, retryAfterMs: Math.max(entry.resetAt - at, 1) };
    },
  };
}

// INCR, and start the window on the first hit. The TTL check repairs a key that lost its expiry.
const COUNT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {n, ttl}
`;

/** Counts in Redis, so every API instance shares a budget. Any Redis failure uses `fallback`. */
export function createRedisStore(
  redis: RedisLike,
  fallback: IpLimitStore,
  { timeoutMs = 1000 }: { timeoutMs?: number } = {},
): IpLimitStore {
  return {
    async hit(key, windowMs) {
      try {
        const reply = await withTimeout(
          redis.eval(COUNT_SCRIPT, 1, key, windowMs),
          timeoutMs,
          'ip limit',
        );
        if (Array.isArray(reply) && typeof reply[0] === 'number' && typeof reply[1] === 'number') {
          return { count: reply[0], retryAfterMs: Math.min(Math.max(reply[1], 1), windowMs) };
        }
      } catch {
        // Redis is down or slow: count here instead. The connection logs its own errors.
      }
      return fallback.hit(key, windowMs);
    },
  };
}

/**
 * Counts one hit on `key` and throws 429 with Retry-After once it passes `max` in the window. If
 * the store itself breaks the request is refused: these limits guard the dear routes, so they never
 * fail open.
 */
export async function enforceLimit(
  res: Response,
  store: IpLimitStore,
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): Promise<void> {
  const hit = await store.hit(key, windowMs).catch(() => null);
  if (hit && hit.count <= max) return;
  res.set('Retry-After', String(Math.max(1, Math.ceil((hit?.retryAfterMs ?? windowMs) / 1000))));
  throw new ApiError(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again');
}

/**
 * 429 with Retry-After once one IP has made more than `max` requests in the window. Needs
 * `trust proxy` set so `req.ip` is the real client. Never fails open (see `enforceLimit`).
 */
export function createIpLimiter({
  name,
  max,
  windowMs,
  store,
}: {
  name: string;
  max: number;
  windowMs: number;
  store: IpLimitStore;
}): RequestHandler {
  return async (req, res, next) => {
    await enforceLimit(res, store, `rl:${name}:${ipKey(req.ip)}`, { max, windowMs });
    next();
  };
}
