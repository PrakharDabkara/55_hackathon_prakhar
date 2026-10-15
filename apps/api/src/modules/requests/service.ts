import type { Logger } from 'pino';
import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { getItem, resolveItem, type CatalogItem, type Quantity } from '../catalog/index.js';
import { findLearnedStock, type LearnedStockResult } from '../shops/index.js';
import {
  applyEvent,
  applyEventIn,
  findOverdueRequestIds,
  findRequest,
  findRequestByKey,
  logTransition,
  type ApplyResult,
  type RequestRecord,
  type TransitionReason,
} from './persistence.js';
import { onRequestPinging } from './pinging.js';
import type { RequestEvent, RequestState } from './stateMachine.js';

export interface RequestHooks {
  /** Queue a delayed expiry job. The database deadline is the truth; this only makes it timely. */
  scheduleExpiry?: (requestId: string, expiresAt: Date) => Promise<void>;
}

export interface RequestsContext {
  db: Database;
  logger: Logger;
  config: { minStockResults: number; ttlMinutes: number; trigramThreshold: number };
  hooks?: RequestHooks;
}

export interface CreateRequestInput {
  q: string;
  lat: number;
  lng: number;
  radiusM?: number | undefined;
  idempotencyKey?: string;
}

export interface RequestView {
  id: string;
  state: RequestState;
  item: CatalogItem | null;
  quantity?: Quantity;
  radiusM: number;
  results: LearnedStockResult[];
  expiresAt: Date;
  createdAt: Date;
}

export const DEFAULT_RADIUS_M = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function toView(
  ctx: RequestsContext,
  r: RequestRecord,
  results?: LearnedStockResult[],
): Promise<RequestView> {
  const [item, found] = await Promise.all([
    getItem(ctx.db, r.itemId),
    results ?? findLearnedStock(ctx.db, r.itemId, r.lat, r.lng, r.radiusM),
  ]);
  return {
    id: r.id,
    state: r.state,
    item,
    ...(r.quantity && { quantity: r.quantity }),
    radiusM: r.radiusM,
    results: found,
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

  const resolution = await resolveItem(ctx.db, input.q, {
    userId,
    threshold: ctx.config.trigramThreshold,
  });
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
                             expires_at, idempotency_key)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
               now() + make_interval(mins => $8::int), $9)
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
  if (record.state === 'PINGING') await onRequestPinging(record);

  return { created: true, request: await toView(ctx, record, stock) };
}

/** The request for its owner, or null for anyone else (so existence is not leaked). */
export async function getRequestStatus(
  ctx: RequestsContext,
  userId: string,
  requestId: string,
): Promise<RequestView | null> {
  if (!UUID.test(requestId)) return null;
  let record = await findRequest(ctx.db, requestId);
  if (!record || record.userId !== userId) return null;

  // Lazy expiry: an overdue request is expired the moment anyone looks, whatever the queue did.
  if (record.overdue && (record.state === 'PINGING' || record.state === 'ANSWERED')) {
    const result = await applyEvent(ctx, record.id, 'TIMEOUT', 'lazy');
    if (result.kind !== 'not_found') record = result.request;
  }
  return toView(ctx, record);
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
  ctx: Pick<RequestsContext, 'db' | 'logger'>,
  requestId: string,
  event: RequestEvent,
  reason: TransitionReason | null = null,
): Promise<ApplyResult> {
  return applyEvent(ctx, requestId, event, reason);
}

/** Fires TIMEOUT if the request is live and past its deadline. Used by the queue job and the sweeper. */
export async function expireRequest(
  deps: Pick<RequestsContext, 'db' | 'logger'>,
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

export { findOverdueRequestIds };
