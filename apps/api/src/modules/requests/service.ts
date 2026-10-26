import { ACTIVE_SEARCH_LIMIT, type ExactQuantity } from '@askbuy/shared';
import { ownsSavedAddress } from './deliveryAddress.js';
import { unitFromQuery } from '@askbuy/shared';
import type { Logger } from 'pino';
import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import type { EventPublisher } from '../realtime/index.js';
import type { AiContext } from '../ai/index.js';
import {
  aiBusyError,
  getItem,
  normaliseQuery,
  refusalError,
  resolveForCustomer,
  type CatalogItem,
  type Quantity,
} from '../catalog/index.js';
import { attachRequestPhoto } from '../photos/index.js';
import { findLearnedStock, type LearnedStockResult } from '../shops/index.js';
import {
  applyEvent,
  applyEventIn,
  findOverdueRequestIds,
  findUnpingedRequestIds,
  findRequest,
  findRequestByKey,
  logTransition,
  type ApplyResult,
  type RequestRecord,
  type TransitionReason,
} from './persistence.js';
import { announceTransition } from './events.js';
import { onRequestPinging } from './pinging.js';
import { buildResults, type LiveAnswer, type RequestResult, type SortKey } from './results.js';
import type { RequestEvent, RequestState } from './stateMachine.js';

export interface RequestHooks {
  /** Queue a delayed expiry job. The database deadline is the truth; this only makes it timely. */
  scheduleExpiry?: (requestId: string, expiresAt: Date) => Promise<void>;
  /** Queue the job that picks shops and sends the pings (a request just went PINGING). */
  enqueueFanout?: (requestId: string) => Promise<void>;
  /** Queue the catch-up for a shop that opened or just joined (ADR-0038). */
  enqueueShopCatchUp?: (shopId: string) => Promise<void>;
}

export interface RequestsContext {
  db: Database;
  logger: Logger;
  config: { minStockResults: number; ttlMinutes: number; trigramThreshold: number };
  hooks?: RequestHooks;
  /** Embeddings and the LLM for item resolution. Without it only the free steps run. */
  ai?: AiContext | undefined;
  /** Realtime hints to the seeker and the shops (ADR-0018). Published after commits only. */
  events?: EventPublisher | undefined;
  /** How many searches (requests and lists, not errands) the customer has live: the limit of 3. */
  activeSearches?: ((userId: string) => Promise<number>) | undefined;
}

export interface CreateRequestInput {
  q: string;
  lat: number;
  lng: number;
  radiusM?: number | undefined;
  /** The price the user has seen elsewhere, in paise. */
  targetPricePaise?: number | undefined;
  /** The item the customer picked after a question; skips resolution. */
  itemId?: string | undefined;
  /**
   * What the customer did with the "Kya aapka matlab…?" question that came before this search:
   * said yes to the understood item, or changed it (another item, or new words). Counted in the
   * logs (ADR-0036); it changes nothing else.
   */
  understanding?: 'confirmed' | 'changed' | undefined;
  /** The customer chose "search exactly what I typed": their words become the item (ADR-0045). */
  asTyped?: boolean | undefined;
  /** An unused photo of the customer's to attach (ADR-0030). */
  photoId?: string | undefined;
  /** The HTTP request id, so AI calls can be traced to it. */
  requestId?: string | undefined;
  /** The errand this request belongs to: a new item counts toward its limit of five. */
  errandId?: string | undefined;
  /** "Deliver to me" (ADR-0039): needs the customer's own saved address. Set by code for errands. */
  wantsDelivery?: boolean | undefined;
  deliveryAddressId?: string | undefined;
  idempotencyKey?: string;
}

export interface RequestView {
  id: string;
  state: RequestState;
  item: CatalogItem | null;
  quantity?: Quantity;
  radiusM: number;
  targetPricePaise?: number;
  wantsDelivery: boolean;
  /** The customer's own words, as typed: their own data, shown back to them (ADR-0047). */
  typed: string;
  /** The customer chose the item from a question: show the item, with their words small. */
  picked: boolean;
  /** The shops have not been chosen yet: "no shops" must not be shown, nor "all have replied". */
  asking: boolean;
  /** The everyday catalog word the text matched ("Maida"), when it differs from the item's name. */
  displayName?: string;
  results: RequestResult[];
  /** How the shops have answered this request so far. */
  pingStats: PingStats;
  expiresAt: Date;
  createdAt: Date;
}

export interface PingStats {
  sent: number;
  yes: number;
  no: number;
  /** Asked and not answered yet. Drops to 0 when the request ends. */
  pending: number;
}

async function pingStats(ctx: RequestsContext, requestId: string): Promise<PingStats> {
  const { rows } = await ctx.db.query<PingStats>(
    `SELECT count(*)::int AS sent,
            count(*) FILTER (WHERE state = 'YES')::int AS yes,
            count(*) FILTER (WHERE state = 'NO')::int AS no,
            count(*) FILTER (WHERE state IN ('QUEUED', 'SENT'))::int AS pending
       FROM pings WHERE request_id = $1`,
    [requestId],
  );
  return rows[0] as PingStats;
}

export const DEFAULT_RADIUS_M = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function liveAnswers(ctx: RequestsContext, r: RequestRecord): Promise<LiveAnswer[]> {
  const { rows } = await ctx.db.query<{
    shop_id: string;
    name: string;
    logo_url: string | null;
    distance_m: number;
    lat: number;
    lng: number;
    price_paise: number | null;
    quantity_hint: LiveAnswer['quantityHint'];
    answered_at: Date;
    photo_id: string | null;
    qty_amount: number | null;
    qty_unit: ExactQuantity['unit'] | null;
    delivers: boolean;
    delivery_fee_paise: number | null;
    delivery_minutes: number | null;
  }>(
    `SELECT s.id AS shop_id, s.name, ST_Distance(s.location, r.location) AS distance_m,
            CASE WHEN s.logo_photo_id IS NOT NULL THEN '/photos/' || s.logo_photo_id END AS logo_url,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            p.price_paise, p.quantity_hint, p.answered_at,
            (SELECT ph.id FROM photos ph WHERE ph.ping_id = p.id) AS photo_id,
            p.qty_amount::float8 AS qty_amount, p.qty_unit, p.delivers,
            p.delivery_fee_paise, p.delivery_minutes
       FROM pings p
       JOIN shops s ON s.id = p.shop_id
       JOIN requests r ON r.id = p.request_id
      WHERE p.request_id = $1 AND p.state = 'YES' AND NOT p.late`,
    [r.id],
  );
  return rows.map((x) => ({
    shopId: x.shop_id,
    name: x.name,
    logoUrl: x.logo_url,
    distanceM: Math.round(x.distance_m),
    lat: x.lat,
    lng: x.lng,
    pricePaise: x.price_paise,
    quantityHint: x.quantity_hint,
    answeredAt: x.answered_at,
    photoId: x.photo_id,
    quantity:
      x.qty_amount !== null && x.qty_unit !== null
        ? { amount: x.qty_amount, unit: x.qty_unit }
        : null,
    delivery: x.delivers ? { feePaise: x.delivery_fee_paise, minutes: x.delivery_minutes } : null,
  }));
}

const sentenceCase = (text: string): string => {
  const [first = ''] = Array.from(text);
  return first.toLocaleUpperCase() + text.slice(first.length);
};

async function toView(
  ctx: RequestsContext,
  r: RequestRecord,
  opts: { learned?: LearnedStockResult[]; sort?: SortKey | undefined } = {},
): Promise<RequestView> {
  const [item, learned, live, stats] = await Promise.all([
    getItem(ctx.db, r.itemId),
    opts.learned ?? findLearnedStock(ctx.db, r.itemId, r.lat, r.lng, r.radiusM),
    liveAnswers(ctx, r),
    pingStats(ctx, r.id),
  ]);
  return {
    id: r.id,
    state: r.state,
    item,
    ...(r.quantity && { quantity: r.quantity }),
    ...(r.targetPricePaise !== null && { targetPricePaise: r.targetPricePaise }),
    radiusM: r.radiusM,
    wantsDelivery: r.wantsDelivery,
    typed: r.rawQuery,
    picked: r.picked,
    asking: r.state === 'PINGING' && r.fannedOutAt === null && !r.overdue,
    ...(r.matchedAlias && { displayName: sentenceCase(r.matchedAlias) }),
    results: buildResults({
      live,
      learned,
      targetPricePaise: r.targetPricePaise,
      sort: opts.sort,
      now: new Date(),
      askedQuantity: r.quantity
        ? { amount: r.quantity.quantity, unit: unitFromQuery(r.quantity.unit) }
        : null,
    }),
    pingStats: stats,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  };
}

/**
 * Resolves the item, counts learned stock, and opens the request: ANSWERED when enough shops
 * already have the item, else PINGING (Day 7 pings shops from there). A repeated
 * Idempotency-Key returns the original request with `created: false`.
 */
export async function createRequest(
  ctx: RequestsContext,
  userId: string,
  input: CreateRequestInput,
): Promise<{ created: boolean; request: RequestView }> {
  const key = input.idempotencyKey;
  if (key) {
    const existing = await findRequestByKey(ctx.db, userId, key);
    if (existing) return { created: false, request: await toView(ctx, existing) };
  }

  // A customer keeps three searches at most (errands are apart): checked first, so a refused
  // fourth costs no AI call and sends nothing to any shop.
  if (
    !input.errandId &&
    ctx.activeSearches &&
    (await ctx.activeSearches(userId)) >= ACTIVE_SEARCH_LIMIT
  )
    throw searchLimitError();

  if (input.understanding)
    ctx.logger.info(
      { event: `understanding_${input.understanding}`, requestId: input.requestId },
      'customer answered what we understood',
    );
  const resolution = await resolveForCustomer(ctx.db, input.q, {
    // A plain search is confirmed before any shop is asked; a picked item (itemId) and an errand's
    // own requests are not.
    confirm: !input.itemId && !input.errandId && !input.asTyped,
    asTyped: input.asTyped === true,
    userId,
    threshold: ctx.config.trigramThreshold,
    itemId: input.itemId,
    logger: ctx.logger,
    ...(ctx.ai && { ai: ctx.ai }),
    ...(input.requestId && { requestId: input.requestId }),
    // A real product the catalog does not know becomes a new item and is asked as plain text.
    openCatalog: { errandId: input.errandId ?? null },
  });
  if (resolution.refused) throw refusalError(resolution.refused);
  if (!resolution.item) {
    // The AI failing is not a verdict on the words: only a truly unclear text is "unresolved".
    if (resolution.aiFailed) throw aiBusyError();
    throw new ApiError(422, 'item_unresolved', 'We could not tell which item you mean');
  }

  // Ticked "Deliver to me": the address must be this customer's own, saved and still there.
  const wantsDelivery = input.wantsDelivery === true;
  if (wantsDelivery && !(await ownsSavedAddress(ctx.db, userId, input.deliveryAddressId)))
    throw new ApiError(
      400,
      'invalid_request',
      'deliveryAddressId: choose one of your saved addresses to get delivery',
    );

  // ADR-0046: an item nobody could file under a kind of shop is asked of the nearest open shops.
  const misc =
    (
      await ctx.db.query<{ uncategorised: boolean }>(
        `SELECT uncategorised FROM items WHERE id = $1`,
        [resolution.item.id],
      )
    ).rows[0]?.uncategorised === true;
  // ADR-0047: the catalog word that matched, only when it is not simply the item's own name.
  const matchedAlias =
    resolution.matchedAlias &&
    resolution.matchedAlias !== normaliseQuery(resolution.item.nameEn).text
      ? resolution.matchedAlias
      : null;

  const radiusM = input.radiusM ?? DEFAULT_RADIUS_M;
  const stock = await findLearnedStock(ctx.db, resolution.item.id, input.lat, input.lng, radiusM);
  const event: RequestEvent =
    stock.length >= ctx.config.minStockResults ? 'STOCK_SUFFICIENT' : 'STOCK_INSUFFICIENT';

  // Insert and first transition commit together, so no one ever sees a request stuck in OPEN.
  const outcome = await withTransaction(ctx.db, async (tx) => {
    // PostGIS points are (x = longitude, y = latitude): lng comes first.
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO requests (user_id, item_id, raw_query, quantity, location, radius_m,
                             expires_at, idempotency_key, target_price_paise,
                             wants_delivery, delivery_address_id, misc, matched_alias, picked)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
               now() + make_interval(mins => $8::int), $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        userId,
        resolution.item?.id,
        input.q,
        resolution.quantity ? JSON.stringify(resolution.quantity) : null,
        input.lng,
        input.lat,
        radiusM,
        ctx.config.ttlMinutes,
        key ?? null,
        input.targetPricePaise ?? null,
        wantsDelivery,
        wantsDelivery ? (input.deliveryAddressId ?? null) : null,
        misc,
        matchedAlias,
        Boolean(input.itemId) && !input.errandId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) return null; // a parallel request with the same key won
    // An error here (a photo that is not yours, or already used) rolls the whole request back.
    if (input.photoId) await attachRequestPhoto(tx, userId, input.photoId, row.id);
    const applied = await applyEventIn(tx, row.id, event);
    return { id: row.id, applied };
  });

  if (!outcome) {
    const winner = (await findRequestByKey(ctx.db, userId, key as string)) as RequestRecord;
    return { created: false, request: await toView(ctx, winner) };
  }

  logTransition(ctx.logger, outcome.applied);
  const record = (await findRequest(ctx.db, outcome.id)) as RequestRecord;

  // After the commit. A failure here must not fail the request: the sweeper and lazy expiry cover it.
  void ctx.hooks?.scheduleExpiry?.(record.id, record.expiresAt).catch((err: unknown) => {
    ctx.logger.warn({ requestId: record.id, err }, 'could not queue expiry job');
  });
  if (record.state === 'PINGING') onRequestPinging(ctx, record);

  return { created: true, request: await toView(ctx, record, { learned: stock }) };
}

/** 409: the customer already has the most searches they may keep; the client asks which to stop. */
export const searchLimitError = (): ApiError =>
  new ApiError(
    409,
    'search_limit',
    `You can have ${ACTIVE_SEARCH_LIMIT} searches at a time. Stop one to start another.`,
    {
      limit: ACTIVE_SEARCH_LIMIT,
    },
  );

/**
 * "Ask shops now": a request answered from remembered stock, with nobody asked, goes to the live
 * shops in range, the ones that remembered it included. The deadline starts again. A request that
 * already has pings keeps them (409 already_asked); asking twice is the same ask.
 */
export async function askShopsNow(
  ctx: RequestsContext,
  userId: string,
  requestId: string,
): Promise<RequestView | null> {
  if (!UUID.test(requestId)) return null;
  const record = await findRequest(ctx.db, requestId);
  if (!record || record.userId !== userId) return null;
  if (record.state === 'PINGING' && !record.overdue) {
    // Already PINGING: the first fan-out left out the shops that remembered the item, and may have
    // asked nobody. Ask everyone now, once (round 3 C-05); a second tap finds ask_all already set.
    if (!record.askAll) {
      const flagged = await ctx.db.query(
        `UPDATE requests SET ask_all = true, fanned_out_at = NULL
          WHERE id = $1 AND state = 'PINGING' AND NOT ask_all`,
        [requestId],
      );
      if (flagged.rowCount) onRequestPinging(ctx, record);
    }
    return toView(ctx, (await findRequest(ctx.db, requestId)) as RequestRecord);
  }
  if (record.state === 'PINGING') return toView(ctx, record);
  if (record.state !== 'ANSWERED' || record.overdue)
    throw new ApiError(409, 'request_ended', 'This search has ended. Start a new one.');

  const result = await withTransaction(ctx.db, async (tx) => {
    const pinged = await tx.query(`SELECT 1 FROM pings WHERE request_id = $1 LIMIT 1`, [requestId]);
    if (pinged.rowCount) return null;
    await tx.query(
      `UPDATE requests SET ask_all = true, fanned_out_at = NULL,
              expires_at = now() + make_interval(mins => $2::int)
        WHERE id = $1`,
      [requestId, ctx.config.ttlMinutes],
    );
    return applyEventIn(tx, requestId, 'ASK_SHOPS', 'user');
  });
  if (!result) throw new ApiError(409, 'already_asked', 'Shops were already asked about this');
  if (result.kind === 'applied') {
    logTransition(ctx.logger, result);
    announceTransition(ctx.events, result, ctx.logger);
    const fresh = (await findRequest(ctx.db, requestId)) as RequestRecord;
    void ctx.hooks?.scheduleExpiry?.(fresh.id, fresh.expiresAt).catch((err: unknown) => {
      ctx.logger.warn({ requestId, err }, 'could not queue expiry job');
    });
    onRequestPinging(ctx, fresh);
  }
  return toView(ctx, (await findRequest(ctx.db, requestId)) as RequestRecord);
}

/** A search still asking or showing answers, not an errand's, not past its deadline. */
const LIVE_REQUEST = `r.user_id = $1 AND r.state IN ('OPEN', 'PINGING', 'ANSWERED') AND r.expires_at > now()
  AND NOT EXISTS (SELECT 1 FROM errand_requests er WHERE er.request_id = r.id)`;

export async function countActiveRequests(db: Database, userId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM requests r WHERE ${LIVE_REQUEST}`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export interface ActiveRequest {
  id: string;
  state: RequestState;
  /** The customer's own words. */
  typed: string;
  item: { nameEn: string; nameHi: string };
  /** The everyday word the text matched ("Maida"), when it is not the item's own name. */
  displayName?: string;
  /** Shops that said yes to this search. */
  replies: number;
  createdAt: Date;
  expiresAt: Date;
}

/** The customer's live searches (requests only), newest first: the cards on the home screen. */
export async function listActiveRequests(db: Database, userId: string): Promise<ActiveRequest[]> {
  const { rows } = await db.query<{
    id: string;
    state: RequestState;
    raw_query: string;
    name_en: string;
    name_hi: string;
    matched_alias: string | null;
    replies: number;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT r.id, r.state, r.raw_query, i.name_en, i.name_hi, r.matched_alias, r.created_at, r.expires_at,
            (SELECT count(*)::int FROM pings p
              WHERE p.request_id = r.id AND p.state = 'YES' AND NOT p.late) AS replies
       FROM requests r JOIN items i ON i.id = r.item_id
      WHERE ${LIVE_REQUEST}
      ORDER BY r.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    state: r.state,
    typed: r.raw_query,
    item: { nameEn: r.name_en, nameHi: r.name_hi },
    ...(r.matched_alias && { displayName: sentenceCase(r.matched_alias) }),
    replies: r.replies,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/** The request for its owner, or null for anyone else (so existence is not leaked). */
export async function getRequestStatus(
  ctx: RequestsContext,
  userId: string,
  requestId: string,
  opts: { sort?: SortKey | undefined } = {},
): Promise<RequestView | null> {
  if (!UUID.test(requestId)) return null;
  let record = await findRequest(ctx.db, requestId);
  if (!record || record.userId !== userId) return null;

  // Lazy expiry: an overdue request is expired the moment anyone looks, whatever the queue did.
  if (record.overdue && (record.state === 'PINGING' || record.state === 'ANSWERED')) {
    const result = await applyEvent(ctx, record.id, 'TIMEOUT', 'lazy');
    if (result.kind !== 'not_found') record = result.request;
  }
  return toView(ctx, record, { sort: opts.sort });
}

/** Closes the owner's request. Closing a finished request returns it as it is. */
export async function closeRequest(
  ctx: RequestsContext,
  userId: string,
  requestId: string,
): Promise<RequestView | null> {
  if (!UUID.test(requestId)) return null;
  const record = await findRequest(ctx.db, requestId);
  if (!record || record.userId !== userId) return null;

  const result = await applyEvent(ctx, record.id, 'USER_CLOSED', 'user');
  return toView(ctx, result.kind === 'not_found' ? record : result.request);
}

/** Feeds an event into a request (Day 7: SHOP_SAID_YES). */
export async function applyRequestEvent(
  ctx: Pick<RequestsContext, 'db' | 'logger' | 'events'>,
  requestId: string,
  event: RequestEvent,
  reason: TransitionReason | null = null,
): Promise<ApplyResult> {
  return applyEvent(ctx, requestId, event, reason);
}

/** Fires TIMEOUT if the request is live and past its deadline. Used by the queue job and the sweeper. */
export async function expireRequest(
  deps: Pick<RequestsContext, 'db' | 'logger' | 'events'>,
  requestId: string,
  reason: Extract<TransitionReason, 'queue' | 'sweeper'>,
): Promise<ApplyResult> {
  const record = await findRequest(deps.db, requestId);
  if (!record) return { kind: 'not_found' };
  if (!record.overdue || (record.state !== 'PINGING' && record.state !== 'ANSWERED')) {
    return { kind: 'unchanged', request: record };
  }
  return applyEvent(deps, requestId, 'TIMEOUT', reason);
}

export { findOverdueRequestIds, findUnpingedRequestIds };

export interface RecentRequest {
  id: string;
  state: RequestState;
  /** The customer's own words. */
  query: string;
  createdAt: Date;
}

/** The customer's latest searches, newest first (for "Haal ke kaam"). */
export async function listRecentRequests(
  db: Database,
  userId: string,
  limit: number,
): Promise<RecentRequest[]> {
  const { rows } = await db.query<{
    id: string;
    state: RequestState;
    raw_query: string;
    created_at: Date;
  }>(
    `SELECT id, state, raw_query, created_at FROM requests
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    state: r.state,
    query: r.raw_query,
    createdAt: r.created_at,
  }));
}
