import type { Logger } from 'pino';
import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import type { EventPublisher } from '../realtime/index.js';
import type { AiContext } from '../ai/index.js';
import {
  getItem,
  refusalError,
  resolveForCustomer,
  type CatalogItem,
  type Quantity,
} from '../catalog/index.js';
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
  /** The HTTP request id, so AI calls can be traced to it. */
  requestId?: string | undefined;
  /** The errand this request belongs to: a new item counts toward its limit of five. */
  errandId?: string | undefined;
  idempotencyKey?: string;
}

export interface RequestView {
  id: string;
  state: RequestState;
  item: CatalogItem | null;
  quantity?: Quantity;
  radiusM: number;
  targetPricePaise?: number;
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
    distance_m: number;
    lat: number;
    lng: number;
    price_paise: number | null;
    quantity_hint: LiveAnswer['quantityHint'];
    answered_at: Date;
  }>(
    `SELECT s.id AS shop_id, s.name, ST_Distance(s.location, r.location) AS distance_m,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            p.price_paise, p.quantity_hint, p.answered_at
       FROM pings p
       JOIN shops s ON s.id = p.shop_id
       JOIN requests r ON r.id = p.request_id
      WHERE p.request_id = $1 AND p.state = 'YES' AND NOT p.late`,
    [r.id],
  );
  return rows.map((x) => ({
    shopId: x.shop_id,
    name: x.name,
    distanceM: Math.round(x.distance_m),
    lat: x.lat,
    lng: x.lng,
    pricePaise: x.price_paise,
    quantityHint: x.quantity_hint,
    answeredAt: x.answered_at,
  }));
}

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
    results: buildResults({
      live,
      learned,
      targetPricePaise: r.targetPricePaise,
      sort: opts.sort,
      now: new Date(),
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

  const resolution = await resolveForCustomer(ctx.db, input.q, {
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

  const radiusM = input.radiusM ?? DEFAULT_RADIUS_M;
  const stock = await findLearnedStock(ctx.db, resolution.item.id, input.lat, input.lng, radiusM);
  const event: RequestEvent =
    stock.length >= ctx.config.minStockResults ? 'STOCK_SUFFICIENT' : 'STOCK_INSUFFICIENT';

  // Insert and first transition commit together, so no one ever sees a request stuck in OPEN.
  const outcome = await withTransaction(ctx.db, async (tx) => {
    // PostGIS points are (x = longitude, y = latitude): lng comes first.
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO requests (user_id, item_id, raw_query, quantity, location, radius_m,
                             expires_at, idempotency_key, target_price_paise)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
               now() + make_interval(mins => $8::int), $9, $10)
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
      ],
    );
    const row = inserted.rows[0];
    if (!row) return null; // a parallel request with the same key won
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
