import type { ExactQuantity } from '@askbuy/shared';
import { ownsSavedAddress } from './deliveryAddress.js';
import { unitFromQuery } from '@askbuy/shared';
import type { Logger } from 'pino';
import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import type { EventPublisher } from '../realtime/index.js';
import type { AiContext } from '../ai/index.js';
import {
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
                             wants_delivery, delivery_address_id, misc, matched_alias)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
               now() + make_interval(mins => $8::int), $9, $10, $11, $12, $13, $14)
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
