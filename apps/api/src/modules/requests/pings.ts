import { GENERAL_STORE_ALSO_TAKES } from '@askbuy/shared';
import type { Logger } from 'pino';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { getItem, getRefPricePaise } from '../catalog/index.js';
import {
  findLearnedStock,
  findShopsWithinRadius,
  recordStockYes,
  shopsToAskAgain,
  type QuantityHint,
} from '../shops/index.js';
import type { EventPublisher } from '../realtime/index.js';
import type { ExactQuantity } from '@askbuy/shared';
import { attachAnswerPhoto } from '../photos/index.js';
import { distanceBand } from './distanceBand.js';
import { announceClosedPings, announceTransition } from './events.js';
import {
  applyEventIn,
  findRequest,
  logTransition,
  withdrawOpenPings,
  type ApplyResult,
  type ClosedPing,
  type RequestRecord,
} from './persistence.js';
import { selectPingTargets } from './targets.js';

/** A late answer (after the request ended) still teaches inventory for this long. ADR-0016. */
const LATE_ANSWER_HOURS = 24;

/** Fewest shops worth asking: below this many matching shops, the nearest of any category join. */
const MIN_TARGETS = 3;

/** The most shops a misc request (an uncategorised item) is sent to, nearest open ones first (ADR-0046). */
export const MISC_FANOUT_MAX = 15;

/** How many candidates to consider per ping we want to send. */
const BACKFILL_FACTOR = 3;

/** The customer sees at most this many live yes; the rest of the shops are told enough answers came (ADR-0043). */
export const MAX_LIVE_OFFERS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may be pinged right now: lets the worker plug in Redis dedupe. */
export interface PingClaims {
  claim(shopId: string, itemId: string): Promise<boolean>;
  release(shopId: string, itemId: string): Promise<void>;
}

export interface FanOutResult {
  targets: number;
  sent: number;
  skipped?: 'not_live';
}

/**
 * Picks the shops to ask and shows them the ping (state SENT: visible in the shop's list).
 * Order of work: choose targets, apply the per-shop dedupe, then insert pings in a transaction that
 * first share-locks the request, so a request that ends meanwhile cannot be left with open pings.
 */
export async function fanOutPings(
  deps: {
    db: Database;
    logger: Logger;
    config: { maxPings: number };
    events?: EventPublisher | undefined;
  },
  requestId: string,
  claims: PingClaims,
): Promise<FanOutResult> {
  const { db, logger } = deps;
  const request = await findRequest(db, requestId);
  if (!request || request.state !== 'PINGING' || request.overdue) {
    logger.info({ requestId }, 'ping fan-out skipped: request is not live');
    return { targets: 0, sent: 0, skipped: 'not_live' };
  }

  const item = await getItem(db, request.itemId);
  if (!item) return { targets: 0, sent: 0 };
  // A misc request ignores the kind of shop and is capped at its own constant, not the normal cap.
  const cap = request.misc ? MISC_FANOUT_MAX : deps.config.maxPings;
  const [nearby, known] = await Promise.all([
    findShopsWithinRadius(request.lat, request.lng, request.radiusM, db),
    findLearnedStock(db, request.itemId, request.lat, request.lng, request.radiusM),
  ]);
  const targets = selectPingTargets(
    nearby.map((s) => ({ shopId: s.id, categories: s.categories, distanceM: s.distance_m })),
    {
      itemCategories: item.categories,
      radiusM: request.radiusM,
      excludeShopIds: new Set(known.map((k) => k.shopId)),
      // Too few shops of the item's kind (a new item, a small street): the nearest of any kind
      // fill up to this many, so a request is never left with nobody to ask (ADR-0028).
      minTargets: MIN_TARGETS,
      // Look past the cap: shops the dedupe refuses are replaced by the next-nearest, up to 3x.
      max: cap * BACKFILL_FACTOR,
      anyCategory: request.misc,
    },
  );
  if (targets.length === 0) {
    logger.info({ requestId }, 'no shop to ping; the request will expire normally');
    return { targets: 0, sent: 0 };
  }

  // Nearest first; a shop pinged recently is skipped and the next one takes its place, until the
  // cap is reached or the candidates run out.
  // A shop whose answer a customer called wrong is asked again even inside the dedupe window: the
  // window was spent on the answer that turned out wrong (ADR-0036). Asked once, it applies again.
  const askAgain = new Set(await shopsToAskAgain(db, request.itemId));
  const claimed: string[] = [];
  let asked = 0;
  for (const t of targets) {
    if (claimed.length >= cap) break;
    asked++;
    if (askAgain.has(t.shopId)) await claims.release(t.shopId, request.itemId);
    if (await claims.claim(t.shopId, request.itemId)) claimed.push(t.shopId);
  }
  const giveBack = () =>
    Promise.all(claimed.map((shopId) => claims.release(shopId, request.itemId)));

  let sent:
    | {
        id: string;
        shopId: string;
        ownerUserId: string | null;
        simulated: boolean;
        categories: string[];
      }[]
    | null;
  try {
    sent = await withTransaction(db, async (tx) => {
      const live = await tx.query<{ ok: boolean }>(
        `SELECT (state = 'PINGING' AND expires_at > now()) AS ok FROM requests WHERE id = $1 FOR SHARE`,
        [requestId],
      );
      if (!live.rows[0]?.ok) return null;
      const inserted = await tx.query<{
        id: string;
        shop_id: string;
        owner_user_id: string | null;
        is_simulated: boolean;
        categories: string[];
      }>(
        `WITH ins AS (
           INSERT INTO pings (request_id, shop_id, item_id, state, sent_at)
           SELECT $1, shop_id, $3, 'SENT', now() FROM unnest($2::uuid[]) AS shop_id
           ON CONFLICT (request_id, shop_id) DO NOTHING
           RETURNING id, shop_id
         )
         SELECT ins.id, ins.shop_id, s.owner_user_id, s.is_simulated, s.categories
           FROM ins JOIN shops s ON s.id = ins.shop_id`,
        [requestId, claimed, request.itemId],
      );
      return inserted.rows.map((r) => ({
        id: r.id,
        shopId: r.shop_id,
        ownerUserId: r.owner_user_id,
        simulated: r.is_simulated,
        categories: r.categories,
      }));
    });
  } catch (err) {
    await giveBack();
    throw err;
  }

  if (sent === null) {
    await giveBack();
    logger.info({ requestId }, 'ping fan-out skipped: request ended meanwhile');
    return { targets: targets.length, sent: 0, skipped: 'not_live' };
  }
  logger.info(
    { requestId, considered: asked, deduped: asked - claimed.length, sent: sent.length },
    'ping fan-out',
  );
  await announcePings(deps, item, sent);
  return { targets: targets.length, sent: sent.length };
}

interface SentPing {
  id: string;
  shopId: string;
  ownerUserId: string | null;
  simulated: boolean;
  categories: string[];
}

/** After the commit: tell each shop (and the simulator) about its new ping so it can fetch it. */
/**
 * Whether the customer wants delivery and whether this shop can bring it that far (ADR-0039).
 * canDeliver is about distance alone: a shop with no limit can always deliver, and a standing
 * offer is only a shortcut for the fee and time. Kept in one place so a ping card and an answer
 * are judged the same way.
 */
const CAN_DELIVER = `(s.delivery_max_km IS NULL OR ST_Distance(s.location, r.location) <= s.delivery_max_km * 1000)`;

async function deliveryFlags(
  db: Queryable,
  pingIds: string[],
): Promise<Map<string, { wantsDelivery: boolean; canDeliver: boolean }>> {
  const { rows } = await db.query<{ id: string; wants: boolean; can: boolean }>(
    `SELECT p.id, r.wants_delivery AS wants, ${CAN_DELIVER} AS can
       FROM pings p JOIN shops s ON s.id = p.shop_id JOIN requests r ON r.id = p.request_id
      WHERE p.id = ANY($1::uuid[])`,
    [pingIds],
  );
  return new Map(rows.map((r) => [r.id, { wantsDelivery: r.wants, canDeliver: r.can }]));
}

async function announcePings(
  deps: { db: Database; logger: Logger; events?: EventPublisher | undefined },
  item: { id: string; slug: string; nameEn: string; category: string; categories: string[] },
  sent: SentPing[],
): Promise<void> {
  const { db, logger } = deps;
  const refPricePaise = sent.some((p) => p.simulated) ? await getRefPricePaise(db, item.id) : null;
  const flags = await deliveryFlags(
    db,
    sent.filter((p) => p.simulated).map((p) => p.id),
  );
  for (const ping of sent) {
    if (ping.ownerUserId) {
      deps.events?.publish(
        { to: { userId: ping.ownerUserId }, type: 'ping.created', data: { pingId: ping.id } },
        logger,
      );
    }
    // The simulator listens on one admin stream for every simulated shop, so it gets what it
    // needs to decide: which shop, which item, and the reference price.
    if (ping.simulated) {
      deps.events?.publish(
        {
          to: { admin: true },
          type: 'ping.created',
          data: {
            pingId: ping.id,
            shopId: ping.shopId,
            item: { slug: item.slug, nameEn: item.nameEn },
            category: item.category,
            itemCategories: item.categories,
            shopCategories: ping.categories,
            refPricePaise,
            wantsDelivery: flags.get(ping.id)?.wantsDelivery ?? false,
            canDeliver: flags.get(ping.id)?.canDeliver ?? true,
          },
        },
        logger,
      );
    }
  }
}

export interface CatchUpResult {
  sent: number;
}

/** A request ending sooner than this is not worth a shop's tap. */
const CATCH_UP_MIN_LIFE = '2 minutes';
/** The most requests one opening shop is told about at once. */
const CATCH_UP_MAX_REQUESTS = 5;

/**
 * A shop that has just opened (or finished onboarding) is asked about the live requests nearby
 * that it was never asked (ADR-0038): still PINGING or ANSWERED with fewer than three live yes, more than 2 minutes left, inside
 * the request's radius, an item of one of the shop's categories, fewer than the maximum pings
 * already sent, and no fresh learned stock of its own. Same dedupe window and same announcements
 * as the fan-out, simulated shops included. Never twice for one request: the ping row is unique.
 */
export async function catchUpShop(
  deps: {
    db: Database;
    logger: Logger;
    config: { maxPings: number };
    events?: EventPublisher | undefined;
  },
  shopId: string,
  claims: PingClaims,
): Promise<CatchUpResult> {
  const { db, logger } = deps;
  if (!UUID.test(shopId)) return { sent: 0 };
  const { rows: due } = await db.query<{ request_id: string; item_id: string }>(
    `SELECT r.id AS request_id, r.item_id
       FROM shops s
       JOIN requests r ON r.state IN ('PINGING', 'ANSWERED')
        AND r.expires_at > now() + interval '${CATCH_UP_MIN_LIFE}'
        AND (SELECT count(*) FROM pings p WHERE p.request_id = r.id AND p.state = 'YES' AND NOT p.late) < $3
        AND ST_DWithin(r.location, s.location, r.radius_m)
       JOIN items i ON i.id = r.item_id
        AND (r.misc OR i.categories && (s.categories::text[] || CASE
              WHEN 'general_store' = ANY(s.categories) THEN $5::text[] ELSE '{}'::text[] END))
      WHERE s.id = $1
        AND (s.closed_until IS NULL OR s.closed_until <= now())
        AND NOT EXISTS (SELECT 1 FROM pings p WHERE p.request_id = r.id AND p.shop_id = s.id)
        AND (SELECT count(*) FROM pings p WHERE p.request_id = r.id)
            < (CASE WHEN r.misc THEN $4::int ELSE $2::int END)
        AND NOT EXISTS (SELECT 1 FROM shop_stock st
                         WHERE st.shop_id = s.id AND st.item_id = r.item_id AND st.expires_at > now())
      ORDER BY r.created_at DESC
      LIMIT ${CATCH_UP_MAX_REQUESTS}`,
    [shopId, deps.config.maxPings, MAX_LIVE_OFFERS, MISC_FANOUT_MAX, [...GENERAL_STORE_ALSO_TAKES]],
  );
  let total = 0;
  for (const { request_id: requestId, item_id: itemId } of due) {
    if (!(await claims.claim(shopId, itemId))) continue;
    let sent: SentPing[] | null;
    try {
      sent = await withTransaction(db, async (tx) => {
        const live = await tx.query<{ ok: boolean }>(
          `SELECT (state IN ('PINGING', 'ANSWERED')
                   AND expires_at > now() + interval '${CATCH_UP_MIN_LIFE}'
                   AND (SELECT count(*) FROM pings p WHERE p.request_id = requests.id AND p.state = 'YES' AND NOT p.late) < $2) AS ok
             FROM requests WHERE id = $1 FOR SHARE`,
          [requestId, MAX_LIVE_OFFERS],
        );
        if (!live.rows[0]?.ok) return null;
        const inserted = await tx.query<{
          id: string;
          shop_id: string;
          owner_user_id: string | null;
          is_simulated: boolean;
          categories: string[];
        }>(
          `WITH ins AS (
             INSERT INTO pings (request_id, shop_id, item_id, state, sent_at)
             VALUES ($1, $2, $3, 'SENT', now())
             ON CONFLICT (request_id, shop_id) DO NOTHING
             RETURNING id, shop_id
           )
           SELECT ins.id, ins.shop_id, s.owner_user_id, s.is_simulated, s.categories
             FROM ins JOIN shops s ON s.id = ins.shop_id`,
          [requestId, shopId, itemId],
        );
        return inserted.rows.map((r) => ({
          id: r.id,
          shopId: r.shop_id,
          ownerUserId: r.owner_user_id,
          simulated: r.is_simulated,
          categories: r.categories,
        }));
      });
    } catch (err) {
      await claims.release(shopId, itemId);
      throw err;
    }
    if (!sent || sent.length === 0) {
      await claims.release(shopId, itemId);
      continue;
    }
    const item = await getItem(db, itemId);
    if (item) await announcePings(deps, item, sent);
    total += sent.length;
  }
  if (total > 0) logger.info({ shopId, sent: total }, 'catch-up pings sent to a shop that opened');
  return { sent: total };
}

const sentenceCase = (text: string): string => {
  const [first = ''] = Array.from(text);
  return first.toLocaleUpperCase() + text.slice(first.length);
};

export interface ShopPing {
  id: string;
  item: { slug: string; nameEn: string; nameHi: string };
  quantity?: { quantity: number; unit: string };
  targetPricePaise?: number;
  distanceBand: string;
  /** What this shop last said it charged for the item; null if never, or the answer was called wrong. */
  lastPricePaise: number | null;
  /** The customer's photo of what they want, if they added one. Fetch it from GET /photos/:id. */
  photoId?: string;
  /** The customer ticked "Deliver to me". The address is not here: a shop learns it once ACCEPTED. */
  wantsDelivery: boolean;
  /** This shop can bring it that far (its own limit, if any). */
  canDeliver: boolean;
  /** What the customer called it, when a catalog word matched ("Maida" for refined flour). Catalog words only (ADR-0047). */
  displayName?: string;
  /** The item could not be filed under a kind of shop, so this shop may not usually stock it (ADR-0046). */
  misc?: true;
  sentAt: Date;
  expiresAt: Date;
}

interface ShopPingRow {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string;
  quantity: { quantity: number; unit: string } | null;
  target_price_paise: number | null;
  distance_m: number;
  last_price_paise: number | null;
  sent_at: Date;
  expires_at: Date;
  photo_id: string | null;
  wants_delivery: boolean;
  can_deliver: boolean;
  misc: boolean;
  matched_alias: string | null;
}

/**
 * This owner's open pings. What a shop may know: the item, how much, the price to beat, and a
 * distance band. Never who asked, where exactly, or what other shops said.
 */
export async function listShopPings(db: Queryable, ownerUserId: string): Promise<ShopPing[]> {
  const { rows } = await db.query<ShopPingRow>(
    `SELECT p.id, i.slug, i.name_en, i.name_hi, r.quantity, r.target_price_paise,
            ST_Distance(s.location, r.location) AS distance_m, p.sent_at, r.expires_at,
            (SELECT st.price_paise FROM shop_stock st
              WHERE st.shop_id = p.shop_id AND st.item_id = p.item_id
                -- a wrong report hides it until the shop answers again
                AND (st.invalidated_at IS NULL OR st.last_confirmed_at >= st.invalidated_at)) AS last_price_paise,
            (SELECT ph.id FROM photos ph WHERE ph.request_id = r.id) AS photo_id,
            r.wants_delivery, ${CAN_DELIVER} AS can_deliver, r.misc, r.matched_alias
       FROM pings p
       JOIN shops s ON s.id = p.shop_id
       JOIN requests r ON r.id = p.request_id
       JOIN items i ON i.id = p.item_id
      WHERE s.owner_user_id = $1 AND p.state = 'SENT' AND r.state IN ('PINGING', 'ANSWERED') AND r.expires_at > now()
      ORDER BY p.sent_at DESC`,
    [ownerUserId],
  );
  return rows.map((r) => ({
    id: r.id,
    item: { slug: r.slug, nameEn: r.name_en, nameHi: r.name_hi },
    ...(r.quantity && { quantity: r.quantity }),
    ...(r.target_price_paise !== null && { targetPricePaise: r.target_price_paise }),
    distanceBand: distanceBand(r.distance_m),
    lastPricePaise: r.last_price_paise,
    ...(r.photo_id && { photoId: r.photo_id }),
    wantsDelivery: r.wants_delivery,
    canDeliver: r.can_deliver,
    ...(r.matched_alias && { displayName: sentenceCase(r.matched_alias) }),
    ...(r.misc && { misc: true as const }),
    sentAt: r.sent_at,
    expiresAt: r.expires_at,
  }));
}

export interface PingAnswer {
  id: string;
  state: 'YES' | 'NO';
  pricePaise: number | null;
  quantityHint: QuantityHint | null;
  late: boolean;
  answeredAt: Date;
}

export interface AnswerInput {
  answer: 'yes' | 'no';
  pricePaise?: number | undefined;
  quantityHint?: QuantityHint | undefined;
  /** The shop's own unused photo, only with a yes. */
  photoId?: string | undefined;
  /** An exact quantity, only with a yes (ADR-0031). */
  quantity?: ExactQuantity | undefined;
  /** "Ghar bhej denge", only with a yes: a fee and a time, either may be left out. */
  delivery?: { feePaise?: number | undefined; minutes?: number | undefined } | undefined;
}

interface PingRow {
  id: string;
  request_id: string;
  shop_id: string;
  item_id: string;
  state: string;
  price_paise: number | null;
  quantity_hint: QuantityHint | null;
  late: boolean;
  answered_at: Date | null;
  owner_user_id: string | null;
}

const PING = `SELECT p.id, p.request_id, p.shop_id, p.item_id, p.state, p.price_paise, p.quantity_hint,
       p.late, p.answered_at, s.owner_user_id
  FROM pings p JOIN shops s ON s.id = p.shop_id`;

const toAnswer = (p: PingRow): PingAnswer => ({
  id: p.id,
  state: p.state as 'YES' | 'NO',
  pricePaise: p.price_paise,
  quantityHint: p.quantity_hint,
  late: p.late,
  answeredAt: p.answered_at as Date,
});

/**
 * A shop answers its ping, once. Locks the request row first (the order every transition uses),
 * then one guarded UPDATE moves the ping out of SENT/NO_REPLY. A yes teaches inventory and, if the
 * request is still live, answers it, all in one transaction. A late answer (the ping was already
 * NO_REPLY) teaches inventory and leaves the request alone. Answering twice returns the first answer.
 * Returns null when the ping is not this owner's.
 */
export async function answerPing(
  deps: { db: Database; logger: Logger; events?: EventPublisher | undefined },
  ownerUserId: string,
  pingId: string,
  input: AnswerInput,
): Promise<PingAnswer | null> {
  if (!UUID.test(pingId)) return null;
  if ((input.photoId || input.quantity || input.delivery) && input.answer !== 'yes')
    throw new ApiError(
      400,
      'invalid_request',
      'A photo, a quantity or a delivery offer can only come with a yes',
    );

  const outcome = await withTransaction(deps.db, async (tx) => {
    const found = await tx.query<PingRow>(`${PING} WHERE p.id = $1`, [pingId]);
    const ping = found.rows[0];
    if (!ping || ping.owner_user_id !== ownerUserId) return null;

    await tx.query('SELECT 1 FROM requests WHERE id = $1 FOR UPDATE', [ping.request_id]);

    // "Ghar bhej denge" only where the shop can reach: beyond its own limit it can say yes, not deliver.
    if (input.delivery && !(await deliveryFlags(tx, [pingId])).get(pingId)?.canDeliver)
      throw new ApiError(
        409,
        'cannot_deliver',
        'This customer is beyond the distance you deliver to',
      );

    const moves: ApplyResult[] = [];
    let enough: ClosedPing[] = [];
    // A request past its deadline is over even if nothing has expired it yet: do that first, so
    // this answer is treated as late rather than reviving the request.
    const request = (await findRequest(tx, ping.request_id)) as RequestRecord;
    if (request.overdue && (request.state === 'PINGING' || request.state === 'ANSWERED')) {
      moves.push(await applyEventIn(tx, request.id, 'TIMEOUT', 'lazy'));
    }

    const yes = input.answer === 'yes';
    const updated = await tx.query<PingRow>(
      `UPDATE pings
          SET state = $2, price_paise = $3, quantity_hint = $4, answered_at = now(),
              late = (state = 'NO_REPLY'),
              qty_amount = $6, qty_unit = $7, delivers = $8,
              delivery_fee_paise = $9, delivery_minutes = $10
        WHERE id = $1 AND state IN ('SENT', 'NO_REPLY')
          AND (state = 'SENT' OR sent_at > now() - make_interval(hours => $5::int))
        RETURNING id, request_id, shop_id, item_id, state, price_paise, quantity_hint, late,
                  answered_at, NULL::uuid AS owner_user_id`,
      [
        pingId,
        yes ? 'YES' : 'NO',
        yes ? (input.pricePaise ?? null) : null,
        yes ? (input.quantityHint ?? null) : null,
        LATE_ANSWER_HOURS,
        yes ? (input.quantity?.amount ?? null) : null,
        yes ? (input.quantity?.unit ?? null) : null,
        yes && Boolean(input.delivery),
        yes ? (input.delivery?.feePaise ?? null) : null,
        yes ? (input.delivery?.minutes ?? null) : null,
      ],
    );

    const row = updated.rows[0];
    if (!row) {
      // Someone (or an earlier call) already answered, or the ping is too old to count.
      const current = (await tx.query<PingRow>(`${PING} WHERE p.id = $1`, [pingId]))
        .rows[0] as PingRow;
      if (current.state === 'YES' || current.state === 'NO')
        return { answer: toAnswer(current), moves, enough, fresh: false };
      throw new ApiError(409, 'ping_closed', 'This ping is too old to answer');
    }

    if (yes) {
      await recordStockYes(tx, {
        shopId: row.shop_id,
        itemId: row.item_id,
        pricePaise: row.price_paise,
        quantityHint: row.quantity_hint,
        quantity: input.quantity ?? null,
        delivery: input.delivery
          ? { feePaise: input.delivery.feePaise ?? null, minutes: input.delivery.minutes ?? null }
          : null,
        confirmedAt: new Date(),
      });
      if (input.photoId) await attachAnswerPhoto(tx, ownerUserId, input.photoId, pingId);
      if (!row.late) {
        moves.push(await applyEventIn(tx, row.request_id, 'SHOP_SAID_YES'));
        // The request lock serialises yeses, so exactly one of them is the last one the customer needs.
        const live = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pings WHERE request_id = $1 AND state = 'YES' AND NOT late`,
          [row.request_id],
        );
        if ((live.rows[0]?.n ?? 0) >= MAX_LIVE_OFFERS)
          enough = await withdrawOpenPings(tx, row.request_id);
      }
    }
    return { answer: toAnswer(row), moves, enough, fresh: true };
  });

  if (!outcome) return null;
  for (const move of outcome.moves) {
    logTransition(deps.logger, move);
    announceTransition(deps.events, move, deps.logger);
  }
  // A repeated answer changed nothing, so it announces nothing.
  if (outcome.fresh) {
    announceClosedPings(deps.events, outcome.enough, 'enough_answers', deps.logger);
    // This shop's ping is finished (it may have it open on another phone).
    deps.events?.publish(
      { to: { userId: ownerUserId }, type: 'ping.closed', data: { pingId, reason: 'answered' } },
      deps.logger,
    );
    // A live yes changes what the seeker sees even when the request was already ANSWERED.
    const last = outcome.moves.at(-1);
    if (outcome.answer.state === 'YES' && !outcome.answer.late && last?.kind === 'unchanged') {
      deps.events?.publish(
        {
          to: { userId: last.request.userId },
          type: 'request.updated',
          data: { requestId: last.request.id, state: last.request.state },
        },
        deps.logger,
      );
    }
  }
  deps.logger.info(
    { pingId, answer: outcome.answer.state, late: outcome.answer.late },
    'ping answered',
  );
  return outcome.answer;
}

/**
 * The customer chose (an order, or a pickup): the shops still holding the question are told the
 * customer already got an answer (ADR-0043). Takes the request lock like every transition, so a yes
 * landing at the same moment is either counted before or stored late after.
 */
export async function withdrawPingsForChoice(
  deps: { db: Database; logger: Logger; events?: EventPublisher | undefined },
  requestId: string,
): Promise<number> {
  if (!UUID.test(requestId)) return 0;
  const closed = await withTransaction(deps.db, async (tx) => {
    await tx.query('SELECT 1 FROM requests WHERE id = $1 FOR UPDATE', [requestId]);
    return withdrawOpenPings(tx, requestId);
  });
  announceClosedPings(deps.events, closed, 'customer_chose', deps.logger);
  return closed.length;
}
