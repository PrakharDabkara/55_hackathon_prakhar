import {
  createRng,
  decide,
  decideList,
  decideOrder,
  hashSeed,
  makeProfile,
  type ShopProfile,
} from '@askbuy/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { answerListPing, findSimulatedParchis } from '../lists/index.js';
import { findSimulatedOrders, shopAct, type ShopVerb } from '../orders/index.js';
import type { EventPublisher, RealtimeEvent } from '../realtime/index.js';
import { answerPing, findSimulatedPings } from '../requests/index.js';

export interface DemoAutopilotOptions {
  db: Database;
  logger: Logger;
  events?: EventPublisher | undefined;
  /** What a list answer needs from the config. */
  lists: { maxPings: number; trigramThreshold: number };
  /** The most answers (and order moves) started in one minute. The rest are not answered. */
  maxPerMinute: number;
  /** Replies come this many times faster than real life. Tests only; the live demo uses 1. */
  speed?: number;
  /** Every shop answers, and never declines an order: for tests that must not depend on luck. */
  eager?: boolean;
  seed?: number;
}

export interface DemoAutopilotStats {
  /** Answers and order chains started. */
  scheduled: number;
  answered: number;
  /** Not answered because the minute's cap was reached. */
  skippedByCap: number;
  /** The shop's answer came too late (the ping or order had ended). */
  late: number;
  failed: number;
  /** Timers waiting right now. */
  pending: number;
  /** The delays of the last answers started, in ms. */
  delaysMs: number[];
}

export interface DemoAutopilot {
  /** Feed every event this process publishes; only the admin stream's new-work events count. */
  onEvent(event: RealtimeEvent): void;
  /** Looks for open work at simulated shops (after a sleep, or events missed) and plans it. Returns how many were planned. */
  catchUp(): Promise<number>;
  stats(): DemoAutopilotStats;
  /** Cancels what is waiting and waits for what is running. Safe to repeat. */
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A task is remembered this long, so a sweep does not plan it again. */
const REMEMBER_MS = 30 * 60_000;
/** Most timers waiting at once: a second guard next to the per-minute cap. */
const MAX_PENDING = 200;
/** An answer with less time than this left is not worth sending. */
const MIN_LEFT_MS = 2000;
/** The replies of a shop are never faster than this (before `speed`), as in the simulator. */
const MIN_DELAY_MS = 5000;
const KEPT_DELAYS = 50;

/**
 * The simulated shops answer from inside the API (ADR-0062). It uses the same answer rules as the
 * laptop simulator (packages/shared), but calls the same service functions the HTTP routes call:
 * no network, no tokens. It only ever acts for shops with is_simulated, because that is all the
 * three finders return, whatever an event says.
 */
export function startDemoAutopilot(options: DemoAutopilotOptions): DemoAutopilot {
  const { db, logger, events } = options;
  const speed = options.speed ?? 1;
  const seed = options.seed ?? 2026;
  const log = logger.child({ component: 'demo-autopilot' });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<void>>();
  const known = new Map<string, number>();
  const recent: number[] = [];
  const stats = { scheduled: 0, answered: 0, skippedByCap: 0, late: 0, failed: 0 };
  const delays: number[] = [];
  let closed = false;

  const profileOf = (shopId: string): ShopProfile =>
    options.eager
      ? { replyProbability: 1, alwaysNo: false, neverDeclines: true }
      : { ...makeProfile(createRng(hashSeed(seed, shopId))), neverDeclines: true };

  /** True if the task is new; remembers it. */
  function remember(key: string): boolean {
    const now = Date.now();
    for (const [k, until] of known) if (until < now) known.delete(k);
    if (known.has(key)) return false;
    known.set(key, now + REMEMBER_MS);
    return true;
  }

  /** The cap: false when this minute already has its share, or too much is waiting. */
  function admit(): boolean {
    const now = Date.now();
    while (recent.length > 0 && (recent[0] as number) < now - 60_000) recent.shift();
    if (recent.length >= options.maxPerMinute || timers.size >= MAX_PENDING) return false;
    recent.push(now);
    return true;
  }

  /** Runs `step` after `ms`; resolves early (without running it) if the autopilot closes. */
  function later(ms: number, step: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      if (closed) return resolve();
      const timer = setTimeout(() => {
        timers.delete(timer);
        step().then(resolve, resolve);
      }, ms);
      timers.add(timer);
      closeWaiters.add(() => {
        clearTimeout(timer);
        timers.delete(timer);
        resolve();
      });
    });
  }
  const closeWaiters = new Set<() => void>();

  function track(work: Promise<void>) {
    const task = work.finally(() => running.delete(task));
    running.add(task);
  }

  /** A delay for a decision that fits before `remainingMs` runs out; null when there is no room. */
  function fit(delayMs: number, remainingMs: number | null): number | null {
    if (remainingMs === null) return delayMs;
    const room = remainingMs - MIN_LEFT_MS;
    if (room < MIN_DELAY_MS / speed) return null;
    return Math.min(delayMs, room);
  }

  function started(delayMs: number) {
    stats.scheduled++;
    delays.push(Math.round(delayMs));
    if (delays.length > KEPT_DELAYS) delays.shift();
  }

  /** What to do with an answer that did not go through. 404 and 409 mean it ended meanwhile. */
  function failed(error: unknown, what: Record<string, unknown>) {
    if (closed) return;
    if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
      stats.late++;
      log.info({ ...what, status: error.status }, 'demo shop answer came too late');
    } else {
      stats.failed++;
      log.warn({ ...what, err: (error as Error).message }, 'demo shop answer failed');
    }
  }

  async function planPings(ids?: string[]): Promise<number> {
    let planned = 0;
    for (const p of await findSimulatedPings(db, ids)) {
      const key = `ping:${p.pingId}`;
      if (known.has(key)) continue;
      const decision = decide(
        profileOf(p.shopId),
        {
          refPricePaise: p.refPricePaise,
          category: p.category,
          itemCategories: p.itemCategories,
          shopCategories: p.shopCategories,
          wantsDelivery: p.wantsDelivery,
          canDeliver: p.canDeliver,
        },
        createRng(hashSeed(seed, p.shopId, p.pingId)),
        speed,
      );
      if (decision.kind === 'skip') {
        remember(key); // this shop chose not to answer; asking again changes nothing
        continue;
      }
      const delay = fit(decision.delayMs, p.remainingMs);
      if (delay === null) continue;
      if (!admit()) {
        stats.skippedByCap++;
        continue;
      }
      remember(key);
      started(delay);
      planned++;
      track(
        later(delay, async () => {
          try {
            await answerPing({ db, logger: log, events }, p.ownerUserId, p.pingId, decision.body);
            stats.answered++;
            log.info(
              { requestId: p.requestId, pingId: p.pingId, answer: decision.body.answer },
              'demo shop answered a ping',
            );
          } catch (error) {
            failed(error, { requestId: p.requestId, pingId: p.pingId });
          }
        }),
      );
    }
    return planned;
  }

  async function planParchis(ids?: string[]): Promise<number> {
    let planned = 0;
    for (const p of await findSimulatedParchis(db, ids)) {
      const key = `list:${p.listPingId}`;
      if (known.has(key)) continue;
      const decision = decideList(
        profileOf(p.shopId),
        {
          listPingId: p.listPingId,
          shopId: p.shopId,
          lines: p.lines,
          wantsDelivery: p.wantsDelivery,
          canDeliver: p.canDeliver,
          shopCategories: p.shopCategories,
        },
        createRng(hashSeed(seed, p.shopId, p.listPingId)),
        speed,
      );
      if (decision.kind === 'skip') {
        remember(key);
        continue;
      }
      const delay = fit(decision.delayMs, p.remainingMs);
      if (delay === null) continue;
      if (!admit()) {
        stats.skippedByCap++;
        continue;
      }
      remember(key);
      started(delay);
      planned++;
      track(
        later(delay, async () => {
          try {
            await answerListPing(
              { db, logger: log, config: options.lists, events },
              p.ownerUserId,
              p.listPingId,
              decision.body,
            );
            stats.answered++;
            log.info({ listId: p.listId, listPingId: p.listPingId }, 'demo shop answered a parchi');
          } catch (error) {
            failed(error, { listId: p.listId, listPingId: p.listPingId });
          }
        }),
      );
    }
    return planned;
  }

  async function planOrders(ids?: string[]): Promise<number> {
    let planned = 0;
    for (const o of await findSimulatedOrders(db, ids)) {
      const key = `order:${o.orderId}`;
      if (known.has(key)) continue;
      const decision = decideOrder(
        profileOf(o.shopId),
        createRng(hashSeed(seed, o.shopId, o.orderId)),
        speed,
        o.state,
      );
      // READY for a pickup, out for a delivery; the customer confirms receipt.
      const last: ShopVerb = o.fulfilment === 'pickup' ? 'ready' : 'out';
      const first =
        decision.kind === 'dispatch'
          ? 0
          : decision.kind === 'accept'
            ? decision.acceptMs
            : decision.delayMs;
      const delay = fit(first, o.remainingMs);
      if (delay === null) continue;
      if (!admit()) {
        stats.skippedByCap++;
        continue;
      }
      remember(key);
      started(delay);
      planned++;
      const act = async (verb: ShopVerb): Promise<boolean> => {
        try {
          await shopAct({ db, logger: log, events }, o.ownerUserId, o.orderId, verb);
          stats.answered++;
          log.info({ orderId: o.orderId, verb }, 'demo shop moved an order');
          return true;
        } catch (error) {
          failed(error, { orderId: o.orderId, verb });
          return false;
        }
      };
      track(
        (async () => {
          if (decision.kind === 'decline') {
            await later(delay, async () => void (await act('decline')));
            return;
          }
          let ok = true;
          if (decision.kind === 'accept')
            await later(delay, async () => void (ok = await act('accept')));
          if (!ok || closed) return;
          const wait = decision.kind === 'accept' ? decision.outMs : delay;
          await later(wait, async () => void (await act(last)));
        })(),
      );
    }
    return planned;
  }

  async function guarded(plan: () => Promise<number>, what: string): Promise<number> {
    if (closed) return 0;
    try {
      return await plan();
    } catch (error) {
      log.warn({ err: (error as Error).message, what }, 'demo autopilot could not look for work');
      return 0;
    }
  }

  return {
    onEvent(event) {
      if (closed || !('admin' in event.to)) return;
      const data = event.data as Record<string, unknown> | null;
      const idOf = (key: string): string[] | null => {
        const id = data?.[key];
        return typeof id === 'string' && UUID.test(id) ? [id] : null;
      };
      // The id only says where to look: the finders read the database and only return simulated shops.
      const [plan, ids] =
        event.type === 'ping.created'
          ? ([planPings, idOf('pingId')] as const)
          : event.type === 'listping.created'
            ? ([planParchis, idOf('listPingId')] as const)
            : event.type === 'order.created'
              ? ([planOrders, idOf('orderId')] as const)
              : ([null, null] as const);
      if (!plan || !ids) return;
      track(guarded(() => plan(ids), event.type).then(() => undefined));
    },
    async catchUp() {
      const counts = await Promise.all([
        guarded(() => planPings(), 'pings'),
        guarded(() => planParchis(), 'parchis'),
        guarded(() => planOrders(), 'orders'),
      ]);
      return counts.reduce((a, b) => a + b, 0);
    },
    stats: () => ({ ...stats, pending: timers.size, delaysMs: [...delays] }),
    async close() {
      closed = true;
      for (const stop of closeWaiters) stop();
      closeWaiters.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await Promise.allSettled([...running]);
    },
  };
}
