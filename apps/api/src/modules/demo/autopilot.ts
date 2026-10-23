import {
  createRng,
  decide,
  decideList,
  decideOrder,
  hashSeed,
  makeProfile,
  type AnswerBody,
  type ListAnswerBody,
  type ShopProfile,
} from '@askbuy/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { answerListPing, findSimulatedParchis } from '../lists/index.js';
import { findSimulatedOrders, shopAct, type ShopVerb } from '../orders/index.js';
import type { EventPublisher, RealtimeEvent } from '../realtime/index.js';
import { answerPing, findSimulatedPings } from '../requests/index.js';

/**
 * The work the autopilot puts on the job queue. A `plan` job decides what a simulated shop does
 * (and is queued by an event, or once at startup); the others are the delayed answers it planned.
 */
export type AutopilotJob =
  | { kind: 'plan'; what: 'ping' | 'list' | 'order'; id: string }
  | { kind: 'ping'; id: string; owner: string; requestId: string; body: AnswerBody }
  | { kind: 'list'; id: string; owner: string; listId: string; body: ListAnswerBody }
  | {
      kind: 'order';
      id: string;
      owner: string;
      verb: ShopVerb;
      /** The step after this one, after its own delay. */
      then?: { verb: ShopVerb; delayMs: number };
    };

/**
 * Where jobs go: the BullMQ queue in the server, a recorder in tests. Same `jobId` twice is one
 * job: the answer is true when this call added it, false when it was already there.
 */
export interface JobQueue {
  enqueue(job: AutopilotJob, options: { jobId: string; delayMs?: number }): Promise<boolean>;
}

export interface DemoAutopilotOptions {
  db: Database;
  logger: Logger;
  queue: JobQueue;
  events?: EventPublisher | undefined;
  /** What a list answer needs from the config. */
  lists: { maxPings: number; trigramThreshold: number };
  /** The most answers (and order chains) planned in one minute. The rest are not answered. */
  maxPerMinute: number;
  /** Replies come this many times faster than real life. Tests only; the live demo uses 1. */
  speed?: number;
  /** Every shop answers, and never declines an order: for tests that must not depend on luck. */
  eager?: boolean;
  seed?: number;
}

export interface DemoAutopilotStats {
  /** Answers and order chains planned. */
  scheduled: number;
  answered: number;
  /** Not answered because the minute's cap was reached. */
  skippedByCap: number;
  /** The shop's answer came too late (the ping or order had ended). */
  late: number;
  failed: number;
  /** Plan jobs queued and not finished. */
  pending: number;
  /** The delays of the last answers planned, in ms. */
  delaysMs: number[];
}

export interface DemoAutopilot {
  /** Feed every event this process publishes; only the admin stream's new-work events queue a plan. */
  onEvent(event: RealtimeEvent): void;
  /**
   * One look at open work at simulated shops, in batches: for when the instance has just woken and
   * missed events. Not a loop. Returns how many plan jobs it queued.
   */
  catchUp(): Promise<number>;
  /** Runs one job from the queue. Never throws: a failed answer is counted and logged. */
  run(job: AutopilotJob): Promise<void>;
  /** Resolves when no plan job is waiting or running. */
  idle(): Promise<void>;
  stats(): DemoAutopilotStats;
  close(): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An answer with less time than this left is not worth sending. */
const MIN_LEFT_MS = 2000;
/** The replies of a shop are never faster than this (before `speed`), as in the simulator. */
const MIN_DELAY_MS = 5000;
const KEPT_DELAYS = 50;
/** The catch-up reads this many of each kind, and queues them this many at a time. */
const CATCH_UP_BATCH = 25;
const ENQUEUE_CHUNK = 10;

/**
 * The simulated shops answer from inside the API (ADR-0062). It uses the same answer rules as the
 * laptop simulator (packages/shared) and calls the same service functions the HTTP routes call.
 * It is event-driven: an event queues a plan job, the plan queues a delayed answer job, and the
 * queue (a few jobs at a time) runs them. Nothing polls. It only ever acts for shops with
 * is_simulated, because that is all the three finders return, whatever an event says.
 */
export function createDemoAutopilot(options: DemoAutopilotOptions): DemoAutopilot {
  const { db, logger, queue, events } = options;
  const speed = options.speed ?? 1;
  const seed = options.seed ?? 2026;
  const log = logger.child({ component: 'demo-autopilot' });
  const recent: number[] = [];
  const stats = { scheduled: 0, answered: 0, skippedByCap: 0, late: 0, failed: 0 };
  const delays: number[] = [];
  const planning = new Set<string>();
  let closed = false;

  const profileOf = (shopId: string): ShopProfile =>
    options.eager
      ? { replyProbability: 1, alwaysNo: false, neverDeclines: true }
      : { ...makeProfile(createRng(hashSeed(seed, shopId))), neverDeclines: true };

  /** The cap: false when this minute already has its share. */
  function admit(): boolean {
    const now = Date.now();
    while (recent.length > 0 && (recent[0] as number) < now - 60_000) recent.shift();
    if (recent.length >= options.maxPerMinute) return false;
    recent.push(now);
    return true;
  }

  /** A delay for a decision that fits before `remainingMs` runs out; null when there is no room. */
  function fit(delayMs: number, remainingMs: number | null): number | null {
    if (remainingMs === null) return delayMs;
    const room = remainingMs - MIN_LEFT_MS;
    if (room < MIN_DELAY_MS / speed) return null;
    return Math.min(delayMs, room);
  }

  function planned(delayMs: number) {
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

  async function planPing(id: string) {
    const [p] = await findSimulatedPings(db, [id]);
    if (!p) return;
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
    if (decision.kind === 'skip') return; // this shop chose not to answer
    const delay = fit(decision.delayMs, p.remainingMs);
    if (delay === null) return;
    if (!admit()) {
      stats.skippedByCap++;
      return;
    }
    planned(delay);
    await queue.enqueue(
      {
        kind: 'ping',
        id: p.pingId,
        owner: p.ownerUserId,
        requestId: p.requestId,
        body: decision.body,
      },
      { jobId: `demo-ping-${p.pingId}`, delayMs: delay },
    );
  }

  async function planParchi(id: string) {
    const [p] = await findSimulatedParchis(db, [id]);
    if (!p) return;
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
    if (decision.kind === 'skip') return;
    const delay = fit(decision.delayMs, p.remainingMs);
    if (delay === null) return;
    if (!admit()) {
      stats.skippedByCap++;
      return;
    }
    planned(delay);
    await queue.enqueue(
      {
        kind: 'list',
        id: p.listPingId,
        owner: p.ownerUserId,
        listId: p.listId,
        body: decision.body,
      },
      { jobId: `demo-list-${p.listPingId}`, delayMs: delay },
    );
  }

  async function planOrder(id: string) {
    const [o] = await findSimulatedOrders(db, [id]);
    if (!o) return;
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
        ? decision.outMs
        : decision.kind === 'accept'
          ? decision.acceptMs
          : decision.delayMs;
    const delay = fit(first, o.remainingMs);
    if (delay === null) return;
    if (!admit()) {
      stats.skippedByCap++;
      return;
    }
    planned(delay);
    const job: AutopilotJob =
      decision.kind === 'accept'
        ? {
            kind: 'order',
            id: o.orderId,
            owner: o.ownerUserId,
            verb: 'accept',
            then: { verb: last, delayMs: decision.outMs },
          }
        : {
            kind: 'order',
            id: o.orderId,
            owner: o.ownerUserId,
            verb: decision.kind === 'decline' ? 'decline' : last,
          };
    await queue.enqueue(job, { jobId: `demo-order-${o.orderId}-${job.verb}`, delayMs: delay });
  }

  async function plan(what: 'ping' | 'list' | 'order', id: string) {
    if (what === 'ping') await planPing(id);
    else if (what === 'list') await planParchi(id);
    else await planOrder(id);
  }

  /** Queues a plan job; the job id makes a repeated event one job. Counted until it has run. */
  async function queuePlan(what: 'ping' | 'list' | 'order', id: string): Promise<boolean> {
    const key = `demo-plan-${what}-${id}`;
    planning.add(key);
    try {
      if (await queue.enqueue({ kind: 'plan', what, id }, { jobId: key })) return true;
    } catch (error) {
      log.warn({ err: (error as Error).message }, 'demo autopilot could not queue a plan');
    }
    planning.delete(key);
    return false;
  }

  const waiting: (() => void)[] = [];
  const wake = () => {
    if (planning.size === 0) for (const resolve of waiting.splice(0)) resolve();
  };

  return {
    onEvent(event) {
      if (closed || !('admin' in event.to)) return;
      const data = event.data as Record<string, unknown> | null;
      const target =
        event.type === 'ping.created'
          ? (['ping', 'pingId'] as const)
          : event.type === 'listping.created'
            ? (['list', 'listPingId'] as const)
            : event.type === 'order.created'
              ? (['order', 'orderId'] as const)
              : null;
      const id = target ? data?.[target[1]] : undefined;
      // The id only says where to look: the finders read the database and only return simulated shops.
      if (!target || typeof id !== 'string' || !UUID.test(id)) return;
      void queuePlan(target[0], id);
    },

    async catchUp() {
      if (closed) return 0;
      try {
        const found: ['ping' | 'list' | 'order', string][] = [
          ...(await findSimulatedPings(db, undefined, CATCH_UP_BATCH)).map(
            (p) => ['ping', p.pingId] as ['ping', string],
          ),
          ...(await findSimulatedParchis(db, undefined, CATCH_UP_BATCH)).map(
            (p) => ['list', p.listPingId] as ['list', string],
          ),
          ...(await findSimulatedOrders(db, undefined, CATCH_UP_BATCH)).map(
            (o) => ['order', o.orderId] as ['order', string],
          ),
        ];
        let added = 0;
        for (let i = 0; i < found.length; i += ENQUEUE_CHUNK) {
          const results = await Promise.all(
            found.slice(i, i + ENQUEUE_CHUNK).map(([what, id]) => queuePlan(what, id)),
          );
          added += results.filter(Boolean).length;
        }
        return added;
      } catch (error) {
        log.warn({ err: (error as Error).message }, 'demo autopilot could not look for work');
        return 0;
      }
    },

    async run(job) {
      if (closed) return;
      try {
        if (job.kind === 'plan') {
          try {
            await plan(job.what, job.id);
          } finally {
            planning.delete(`demo-plan-${job.what}-${job.id}`);
            wake();
          }
        } else if (job.kind === 'ping') {
          await answerPing({ db, logger: log, events }, job.owner, job.id, job.body);
          stats.answered++;
          log.info(
            { requestId: job.requestId, pingId: job.id, answer: job.body.answer },
            'demo shop answered a ping',
          );
        } else if (job.kind === 'list') {
          await answerListPing(
            { db, logger: log, config: options.lists, events },
            job.owner,
            job.id,
            job.body,
          );
          stats.answered++;
          log.info({ listId: job.listId, listPingId: job.id }, 'demo shop answered a parchi');
        } else {
          await shopAct({ db, logger: log, events }, job.owner, job.id, job.verb);
          stats.answered++;
          log.info({ orderId: job.id, verb: job.verb }, 'demo shop moved an order');
          if (job.then)
            await queue.enqueue(
              { kind: 'order', id: job.id, owner: job.owner, verb: job.then.verb },
              { jobId: `demo-order-${job.id}-${job.then.verb}`, delayMs: job.then.delayMs },
            );
        }
      } catch (error) {
        failed(error, { kind: job.kind, id: job.id });
      }
    },

    idle: () =>
      planning.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiting.push(resolve)),
    stats: () => ({ ...stats, pending: planning.size, delaysMs: [...delays] }),
    close() {
      closed = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}
