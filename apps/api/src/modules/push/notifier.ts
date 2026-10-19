import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { claimPickupReminders } from '../pickups/index.js';
import type { RealtimeEvent } from '../realtime/index.js';
import { buildPayload, type PushKind } from './payload.js';
import type { RateLimiter } from './rateLimit.js';
import type { PushJob } from './sender.js';
import { listSubscriptionIds } from './subscriptions.js';

export interface EnqueueOptions {
  /** Pushes with the same key are queued once per browser: a burst becomes one notification. */
  key?: string;
  delayMs?: number;
}
export type EnqueuePush = (job: PushJob, options?: EnqueueOptions) => Promise<void>;

export interface Notifier {
  /** Reacts to an event the app has just published (so, after its commit). Never throws. */
  handle(event: RealtimeEvent): void;
  /**
   * "Le liya?" reminders (ADR-0035): one push per customer for the pickups an hour old that the
   * home screen has not asked about. Returns how many customers were pushed.
   */
  remindPickups(now?: Date): Promise<number>;
  /** Resolves when every event handed in so far has been dealt with (tests). */
  idle(): Promise<void>;
}

const ORDER_KINDS: Record<string, PushKind> = {
  ACCEPTED: 'order_accepted',
  DECLINED: 'order_declined',
  OUT_FOR_DELIVERY: 'order_out',
  DELIVERED: 'order_delivered',
};

interface Deps {
  db: Database;
  logger: Logger;
  enqueue: EnqueuePush;
  limiter: RateLimiter;
  /** How long to wait after the first yes before telling the customer, so a burst is one push. */
  answerDebounceMs: number;
}

const userOf = (event: RealtimeEvent): string | null =>
  'userId' in event.to ? event.to.userId : null;
const dataOf = (event: RealtimeEvent): Record<string, unknown> =>
  typeof event.data === 'object' && event.data !== null
    ? (event.data as Record<string, unknown>)
    : {};

/**
 * Turns the events the app already publishes (ids and a state, ADR-0018) into Web Push jobs.
 * What a push says is looked up here from the database and built by `buildPayload`, so nothing
 * but a title, an item name and a link can leave. Simulated shops are never pushed.
 */
export function createNotifier(deps: Deps): Notifier {
  const { db, logger, enqueue, limiter } = deps;
  const inFlight = new Set<Promise<void>>();

  /** One push to everything the person has subscribed, counted once against their limit. */
  async function notify(
    userId: string,
    kind: PushKind,
    args: { item?: string; id?: string },
    options?: EnqueueOptions,
  ): Promise<boolean> {
    const subscriptions = await listSubscriptionIds(db, userId);
    if (subscriptions.length === 0) return false;
    if (!(await limiter.allow(userId))) {
      logger.info({ kind }, 'push dropped: too many for this person in a minute');
      return false;
    }
    const payload = buildPayload(kind, args);
    for (const subscriptionId of subscriptions) {
      await enqueue({ subscriptionId, payload }, options);
    }
    logger.info({ kind, devices: subscriptions.length }, 'push queued');
    return true;
  }

  async function onPing(userId: string, pingId: string) {
    const { rows } = await db.query<{ name_en: string; is_simulated: boolean }>(
      `SELECT i.name_en, s.is_simulated
         FROM pings p JOIN shops s ON s.id = p.shop_id JOIN items i ON i.id = p.item_id
        WHERE p.id = $1 AND s.owner_user_id = $2`,
      [pingId, userId],
    );
    const row = rows[0];
    if (!row || row.is_simulated) return;
    await notify(userId, 'new_ping', { item: row.name_en });
  }

  interface OrderRow {
    user_id: string;
    state: string;
    lines: { name: string }[];
    owner_user_id: string | null;
    is_simulated: boolean;
  }
  const loadOrder = async (orderId: string) =>
    (
      await db.query<OrderRow>(
        `SELECT o.user_id, o.state, o.lines, s.owner_user_id, s.is_simulated
           FROM delivery_orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0];
  const orderItem = (lines: { name: string }[]) =>
    lines.length > 1 ? `${lines[0]?.name ?? ''} +${lines.length - 1}` : (lines[0]?.name ?? '');

  async function onOrderCreated(userId: string, orderId: string) {
    const order = await loadOrder(orderId);
    if (!order || order.owner_user_id !== userId || order.is_simulated) return;
    await notify(userId, 'new_order', { item: orderItem(order.lines) });
  }

  async function onOrderUpdated(userId: string, orderId: string) {
    const order = await loadOrder(orderId);
    // The same event also goes to the shop; only the customer hears about the shop's own taps.
    if (!order || order.user_id !== userId) return;
    const kind = ORDER_KINDS[order.state];
    if (!kind) return;
    await notify(userId, kind, { item: orderItem(order.lines), id: orderId });
  }

  async function onRequestAnswered(userId: string, requestId: string) {
    const { rows } = await db.query<{ name_en: string | null; yes: boolean; errand: boolean }>(
      `SELECT i.name_en,
              EXISTS (SELECT 1 FROM pings p WHERE p.request_id = r.id AND p.state = 'YES' AND NOT p.late) AS yes,
              EXISTS (SELECT 1 FROM errands e WHERE e.user_id = r.user_id
                        AND e.state IN ('PLANNING', 'WAITING_FOR_SHOPS', 'NEEDS_INPUT')) AS errand
         FROM requests r JOIN items i ON i.id = r.item_id
        WHERE r.id = $1 AND r.user_id = $2`,
      [requestId, userId],
    );
    const row = rows[0];
    // While an errand is planning its searches are its own; "Plan taiyaar" is the one push for it.
    if (!row || !row.yes || row.errand) return;
    await notify(
      userId,
      'shop_answered',
      { item: row.name_en ?? '', id: requestId },
      { key: `answer:${requestId}`, delayMs: deps.answerDebounceMs },
    );
  }

  async function onErrandReady(userId: string, errandId: string) {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT state = 'PLAN_READY' AS ok FROM errands WHERE id = $1 AND user_id = $2`,
      [errandId, userId],
    );
    if (!rows[0]?.ok) return;
    await notify(userId, 'plan_ready', { id: errandId }, { key: `plan:${errandId}` });
  }

  async function dispatch(event: RealtimeEvent): Promise<void> {
    const userId = userOf(event);
    if (!userId) return;
    const data = dataOf(event);
    const id = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : null);
    switch (event.type) {
      case 'ping.created': {
        const pingId = id('pingId');
        if (pingId) await onPing(userId, pingId);
        return;
      }
      case 'order.created': {
        const orderId = id('orderId');
        if (orderId) await onOrderCreated(userId, orderId);
        return;
      }
      case 'order.updated': {
        const orderId = id('orderId');
        if (orderId) await onOrderUpdated(userId, orderId);
        return;
      }
      case 'request.updated': {
        const requestId = id('requestId');
        if (requestId && data['state'] === 'ANSWERED') await onRequestAnswered(userId, requestId);
        return;
      }
      case 'errand.updated': {
        const errandId = id('errandId');
        if (errandId && data['state'] === 'PLAN_READY') await onErrandReady(userId, errandId);
        return;
      }
    }
  }

  return {
    handle(event) {
      const run = dispatch(event)
        .catch((err: Error) =>
          logger.warn({ type: event.type, reason: err.message }, 'could not queue a push'),
        )
        .finally(() => inFlight.delete(run));
      inFlight.add(run);
    },
    async remindPickups(now = new Date()) {
      let pushed = 0;
      for (const { userId, items } of await claimPickupReminders(db, now)) {
        const first = items[0] ?? '';
        const item = items.length > 1 ? `${first} +${items.length - 1}` : first;
        if (await notify(userId, 'pickup_ask', { item })) pushed += 1;
      }
      return pushed;
    },
    async idle() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
}
