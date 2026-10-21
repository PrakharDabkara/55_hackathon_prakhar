import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { claimPickupReminders } from '../pickups/index.js';
import type { RealtimeEvent } from '../realtime/index.js';
import { distanceBand } from '../requests/index.js';
import { buildPayload, type PushArgs, type PushKind } from './payload.js';
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
    args: PushArgs,
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
    const { rows } = await db.query<{
      name_en: string;
      is_simulated: boolean;
      closed: boolean;
      distance_m: number;
      waiting: number;
    }>(
      `SELECT i.name_en, s.is_simulated,
              (s.closed_until IS NOT NULL AND s.closed_until > now()) AS closed,
              ST_Distance(s.location, r.location) AS distance_m,
              (SELECT count(*)::int FROM pings w JOIN requests wr ON wr.id = w.request_id
                WHERE w.shop_id = s.id AND w.state = 'SENT'
                  AND wr.state IN ('PINGING', 'ANSWERED') AND wr.expires_at > now()) AS waiting
         FROM pings p JOIN shops s ON s.id = p.shop_id JOIN items i ON i.id = p.item_id
         JOIN requests r ON r.id = p.request_id
        WHERE p.id = $1 AND s.owner_user_id = $2`,
      [pingId, userId],
    );
    const row = rows[0];
    // A closed shop is not nagged: its card waits in the list (scenario S9).
    if (!row || row.is_simulated || row.closed) return;
    // One notification per shop: it says how many others are waiting too.
    await notify(userId, 'new_ping', {
      item: row.name_en,
      band: distanceBand(row.distance_m),
      more: Math.max(0, row.waiting - 1),
    });
  }

  /** One push per shop per list: the first line and how many more, a distance band, tagged for the list. */
  async function onListPing(userId: string, listPingId: string) {
    const { rows } = await db.query<{
      list_id: string;
      is_simulated: boolean;
      closed: boolean;
      distance_m: number;
      names: string[];
    }>(
      `SELECT lp.list_id, s.is_simulated,
              (s.closed_until IS NOT NULL AND s.closed_until > now()) AS closed,
              ST_Distance(s.location, l.location) AS distance_m,
              array(SELECT coalesce(i.name_en, ll.text)
                      FROM list_ping_lines lpl
                      JOIN list_lines ll ON ll.id = lpl.line_id
                      LEFT JOIN items i ON i.id = ll.item_id
                     WHERE lpl.list_ping_id = lp.id ORDER BY ll.position) AS names
         FROM list_pings lp JOIN shops s ON s.id = lp.shop_id JOIN shopping_lists l ON l.id = lp.list_id
        WHERE lp.id = $1 AND s.owner_user_id = $2`,
      [listPingId, userId],
    );
    const row = rows[0];
    // Simulated shops are never pushed, and a closed shop is not nagged (its parchi waits in the list).
    if (!row || row.is_simulated || row.closed) return;
    const first = row.names[0] ?? '';
    await notify(userId, 'new_list', {
      item: row.names.length > 1 ? `${first} +${row.names.length - 1}` : first,
      band: distanceBand(row.distance_m),
      id: row.list_id,
    });
  }

  interface OrderRow {
    user_id: string;
    state: string;
    lines: { name: string }[];
    shop_name: string;
    owner_user_id: string | null;
    is_simulated: boolean;
    cancelled_by: string | null;
  }
  const loadOrder = async (orderId: string) =>
    (
      await db.query<OrderRow>(
        `SELECT o.user_id, o.state, o.lines, s.name AS shop_name, s.owner_user_id, s.is_simulated, o.cancelled_by
           FROM delivery_orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0];
  const orderItem = (lines: { name: string }[]) =>
    lines.length > 1 ? `${lines[0]?.name ?? ''} +${lines.length - 1}` : (lines[0]?.name ?? '');

  async function onOrderCreated(userId: string, orderId: string) {
    const order = await loadOrder(orderId);
    if (!order || order.owner_user_id !== userId || order.is_simulated) return;
    // A fresh offer the customer took is binding: the order starts ACCEPTED and the shop is told
    // the customer chose it, not asked to accept.
    const kind = order.state === 'ACCEPTED' ? 'order_chosen' : 'new_order';
    await notify(userId, kind, { item: orderItem(order.lines), id: orderId });
  }

  async function onOrderUpdated(userId: string, orderId: string) {
    const order = await loadOrder(orderId);
    if (!order) return;
    // The shop hears about an order when it is placed or chosen, and nothing after: its own taps
    // and the customer's Received need no action from it.
    if (order.owner_user_id === userId && order.user_id !== userId) return;
    // The same event also goes to the shop; only the customer hears about the shop's own taps.
    if (order.user_id !== userId) return;
    // A customer is not pushed about their own cancel, only about the shop's.
    if (order.state === 'CANCELLED') {
      if (order.cancelled_by === 'shop')
        await notify(userId, 'order_cancelled_by_shop', {
          item: orderItem(order.lines),
          id: orderId,
          shop: order.shop_name,
        });
      return;
    }
    const kind = ORDER_KINDS[order.state];
    if (!kind) return;
    await notify(userId, kind, {
      item: orderItem(order.lines),
      id: orderId,
      shop: order.shop_name,
    });
  }

  async function onRequestAnswered(userId: string, requestId: string) {
    const { rows } = await db.query<{ name_en: string | null; errand: boolean }>(
      `SELECT i.name_en,
              EXISTS (SELECT 1 FROM errand_requests er JOIN errands e ON e.id = er.errand_id
                       WHERE er.request_id = r.id
                         AND e.state IN ('PLANNING', 'WAITING_FOR_SHOPS', 'NEEDS_INPUT')) AS errand
         FROM requests r JOIN items i ON i.id = r.item_id
        WHERE r.id = $1 AND r.user_id = $2`,
      [requestId, userId],
    );
    const row = rows[0];
    // The searches an errand opened itself (errand_requests) are its own while it is planning:
    // "Plan taiyaar" is the one push for them. The customer's separate searches still get theirs.
    if (!row || row.errand) return;
    const yes = (
      await db.query<{ name: string; price_paise: number | null }>(
        `SELECT s.name, p.price_paise
           FROM pings p JOIN shops s ON s.id = p.shop_id
          WHERE p.request_id = $1 AND p.state = 'YES' AND NOT p.late
          ORDER BY p.price_paise ASC NULLS LAST, p.answered_at ASC`,
        [requestId],
      )
    ).rows;
    const cheapest = yes[0];
    if (!cheapest) return;
    // One notification per request (tag req:<id>): the first yes alerts, the next ones update it
    // quietly with the count and the lowest price. The key is per count so each is queued once.
    await notify(
      userId,
      'shop_answered',
      {
        item: row.name_en ?? '',
        id: requestId,
        shop: cheapest.name,
        shops: yes.length,
        ...(cheapest.price_paise !== null && { pricePaise: cheapest.price_paise }),
      },
      { key: `answer:${requestId}:${yes.length}`, delayMs: deps.answerDebounceMs },
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
      case 'listping.created': {
        const listPingId = id('listPingId');
        if (listPingId) await onListPing(userId, listPingId);
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
