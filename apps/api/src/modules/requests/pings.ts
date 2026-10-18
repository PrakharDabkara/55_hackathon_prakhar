import type { Logger } from 'pino';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { getItem, getRefPricePaise } from '../catalog/index.js';
import {
  findLearnedStock,
  findShopsWithinRadius,
  recordStockYes,
  type QuantityHint,
} from '../shops/index.js';
import type { EventPublisher } from '../realtime/index.js';
import { attachAnswerPhoto } from '../photos/index.js';
import { distanceBand } from './distanceBand.js';
import { announceTransition } from './events.js';
import {
  applyEventIn,
  findRequest,
  logTransition,
  type ApplyResult,
  type RequestRecord,
} from './persistence.js';
import { selectPingTargets } from './targets.js';

/** A late answer (after the request ended) still teaches inventory for this long. ADR-0016. */
const LATE_ANSWER_HOURS = 24;

/** Fewest shops worth asking: below this many matching shops, the nearest of any category join. */
const MIN_TARGETS = 3;

/** How many candidates to consider per ping we want to send. */
const BACKFILL_FACTOR = 3;

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
      max: deps.config.maxPings * BACKFILL_FACTOR,
    },
  );
  if (targets.length === 0) {
    logger.info({ requestId }, 'no shop to ping; the request will expire normally');
    return { targets: 0, sent: 0 };
  }

  // Nearest first; a shop pinged recently is skipped and the next one takes its place, until the
  // cap is reached or the candidates run out.
  const claimed: string[] = [];
  let asked = 0;
  for (const t of targets) {
    if (claimed.length >= deps.config.maxPings) break;
    asked++;
    if (await claims.claim(t.shopId, request.itemId)) claimed.push(t.shopId);
  }
  const giveBack = () =>
    Promise.all(claimed.map((shopId) => claims.release(shopId, request.itemId)));

  let sent: { id: string; shopId: string; ownerUserId: string | null; simulated: boolean }[] | null;
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
      }>(
        `WITH ins AS (
           INSERT INTO pings (request_id, shop_id, item_id, state, sent_at)
           SELECT $1, shop_id, $3, 'SENT', now() FROM unnest($2::uuid[]) AS shop_id
           ON CONFLICT (request_id, shop_id) DO NOTHING
           RETURNING id, shop_id
         )
         SELECT ins.id, ins.shop_id, s.owner_user_id, s.is_simulated
           FROM ins JOIN shops s ON s.id = ins.shop_id`,
        [requestId, claimed, request.itemId],
      );
      return inserted.rows.map((r) => ({
        id: r.id,
        shopId: r.shop_id,
        ownerUserId: r.owner_user_id,
        simulated: r.is_simulated,
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
  // After the commit: a shop told about a ping must be able to fetch it.
  const refPricePaise = sent.some((p) => p.simulated) ? await getRefPricePaise(db, item.id) : null;
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
            refPricePaise,
          },
        },
        logger,
      );
    }
  }
  return { targets: targets.length, sent: sent.length };
}

export interface ShopPing {
  id: string;
  item: { slug: string; nameEn: string; nameHi: string };
  quantity?: { quantity: number; unit: string };
  targetPricePaise?: number;
  distanceBand: string;
  /** The customer's photo of what they want, if they added one. Fetch it from GET /photos/:id. */
  photoId?: string;
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
  sent_at: Date;
  expires_at: Date;
  photo_id: string | null;
}

/**
 * This owner's open pings. What a shop may know: the item, how much, the price to beat, and a
 * distance band. Never who asked, where exactly, or what other shops said.
 */
export async function listShopPings(db: Queryable, ownerUserId: string): Promise<ShopPing[]> {
  const { rows } = await db.query<ShopPingRow>(
    `SELECT p.id, i.slug, i.name_en, i.name_hi, r.quantity, r.target_price_paise,
            ST_Distance(s.location, r.location) AS distance_m, p.sent_at, r.expires_at,
            (SELECT ph.id FROM photos ph WHERE ph.request_id = r.id) AS photo_id
       FROM pings p
       JOIN shops s ON s.id = p.shop_id
       JOIN requests r ON r.id = p.request_id
       JOIN items i ON i.id = p.item_id
      WHERE s.owner_user_id = $1 AND p.state = 'SENT' AND r.state = 'PINGING' AND r.expires_at > now()
      ORDER BY p.sent_at DESC`,
    [ownerUserId],
  );
  return rows.map((r) => ({
    id: r.id,
    item: { slug: r.slug, nameEn: r.name_en, nameHi: r.name_hi },
    ...(r.quantity && { quantity: r.quantity }),
    ...(r.target_price_paise !== null && { targetPricePaise: r.target_price_paise }),
    distanceBand: distanceBand(r.distance_m),
    ...(r.photo_id && { photoId: r.photo_id }),
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
  if (input.photoId && input.answer !== 'yes')
    throw new ApiError(400, 'invalid_request', 'A photo can only come with a yes');

  const outcome = await withTransaction(deps.db, async (tx) => {
    const found = await tx.query<PingRow>(`${PING} WHERE p.id = $1`, [pingId]);
    const ping = found.rows[0];
    if (!ping || ping.owner_user_id !== ownerUserId) return null;

    await tx.query('SELECT 1 FROM requests WHERE id = $1 FOR UPDATE', [ping.request_id]);

    const moves: ApplyResult[] = [];
    // A request past its deadline is over even if nothing has expired it yet: do that first, so
    // this answer is treated as late rather than reviving the request.
    const request = (await findRequest(tx, ping.request_id)) as RequestRecord;
    if (request.overdue && request.state === 'PINGING') {
      moves.push(await applyEventIn(tx, request.id, 'TIMEOUT', 'lazy'));
    }

    const yes = input.answer === 'yes';
    const updated = await tx.query<PingRow>(
      `UPDATE pings
          SET state = $2, price_paise = $3, quantity_hint = $4, answered_at = now(),
              late = (state = 'NO_REPLY')
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
      ],
    );

    const row = updated.rows[0];
    if (!row) {
      // Someone (or an earlier call) already answered, or the ping is too old to count.
      const current = (await tx.query<PingRow>(`${PING} WHERE p.id = $1`, [pingId]))
        .rows[0] as PingRow;
      if (current.state === 'YES' || current.state === 'NO')
        return { answer: toAnswer(current), moves, fresh: false };
      throw new ApiError(409, 'ping_closed', 'This ping is too old to answer');
    }

    if (yes) {
      await recordStockYes(tx, {
        shopId: row.shop_id,
        itemId: row.item_id,
        pricePaise: row.price_paise,
        quantityHint: row.quantity_hint,
        confirmedAt: new Date(),
      });
      if (input.photoId) await attachAnswerPhoto(tx, ownerUserId, input.photoId, pingId);
      if (!row.late) moves.push(await applyEventIn(tx, row.request_id, 'SHOP_SAID_YES'));
    }
    return { answer: toAnswer(row), moves, fresh: true };
  });

  if (!outcome) return null;
  for (const move of outcome.moves) {
    logTransition(deps.logger, move);
    announceTransition(deps.events, move, deps.logger);
  }
  // A repeated answer changed nothing, so it announces nothing.
  if (outcome.fresh) {
    // This shop's ping is finished (it may have it open on another phone).
    deps.events?.publish(
      { to: { userId: ownerUserId }, type: 'ping.closed', data: { pingId } },
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
