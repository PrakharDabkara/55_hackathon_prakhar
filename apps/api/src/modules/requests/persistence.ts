import type { Logger } from 'pino';
import { withTransaction, type Database, type Queryable } from '../../db/queryable.js';
import type { Quantity } from '../catalog/index.js';
import type { EventPublisher } from '../realtime/index.js';
import { announceTransition } from './events.js';
import { transition, type RequestEvent, type RequestState } from './stateMachine.js';

export type TransitionReason = 'user' | 'queue' | 'sweeper' | 'lazy';

export interface RequestRecord {
  id: string;
  userId: string;
  itemId: string;
  rawQuery: string;
  quantity: Quantity | null;
  targetPricePaise: number | null;
  radiusM: number;
  state: RequestState;
  version: number;
  expiresAt: Date;
  createdAt: Date;
  lat: number;
  lng: number;
  /** Past its deadline by the database clock. */
  overdue: boolean;
}

interface Row {
  id: string;
  user_id: string;
  item_id: string;
  raw_query: string;
  quantity: Quantity | null;
  target_price_paise: number | null;
  radius_m: number;
  state: RequestState;
  version: number;
  expires_at: Date;
  created_at: Date;
  lat: number;
  lng: number;
  overdue: boolean;
}

const SELECT = `SELECT r.id, r.user_id, r.item_id, r.raw_query, r.quantity, r.target_price_paise, r.radius_m, r.state,
       r.version, r.expires_at, r.created_at,
       ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
       (r.expires_at <= now()) AS overdue
  FROM requests r`;

const toRecord = (r: Row): RequestRecord => ({
  id: r.id,
  userId: r.user_id,
  itemId: r.item_id,
  rawQuery: r.raw_query,
  quantity: r.quantity,
  targetPricePaise: r.target_price_paise,
  radiusM: r.radius_m,
  state: r.state,
  version: r.version,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  lat: r.lat,
  lng: r.lng,
  overdue: r.overdue,
});

export async function findRequest(db: Queryable, id: string): Promise<RequestRecord | null> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE r.id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function findRequestByKey(
  db: Queryable,
  userId: string,
  key: string,
): Promise<RequestRecord | null> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE r.user_id = $1 AND r.idempotency_key = $2`,
    [userId, key],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export type ApplyResult =
  /** This call moved the request. */
  | {
      kind: 'applied';
      request: RequestRecord;
      from: RequestState;
      event: RequestEvent;
      reason: TransitionReason | null;
      /** Pings that went NO_REPLY because the request left PINGING, with their shop owners. */
      closedPings: { id: string; ownerUserId: string | null }[];
    }
  /** Nothing moved: a no-op event, or someone else moved the request first. `request` is the current state. */
  | { kind: 'unchanged'; request: RequestRecord }
  /** The state does not accept this event. */
  | {
      kind: 'invalid';
      request: RequestRecord;
      error: { code: 'INVALID_TRANSITION'; state: RequestState; event: RequestEvent };
    }
  | { kind: 'not_found' };

/**
 * Moves a request in one transaction. The UPDATE is guarded by the state we read
 * (`WHERE state = $from`), so of two concurrent events on the same state exactly one updates the
 * row; the other updates zero rows and gets the current state back. Never overwrites.
 */
export async function applyEventIn(
  tx: Queryable,
  requestId: string,
  event: RequestEvent,
  reason: TransitionReason | null = null,
): Promise<ApplyResult> {
  const current = await findRequest(tx, requestId);
  if (!current) return { kind: 'not_found' };

  const result = transition(current.state, event);
  if (!result.ok) return { kind: 'invalid', request: current, error: result.error };
  if (!result.changed) return { kind: 'unchanged', request: current };

  const moved = await tx.query(
    `UPDATE requests
        SET state = $2, version = version + 1, updated_at = now()
      WHERE id = $1 AND state = $3
      RETURNING id`,
    [requestId, result.to, current.state],
  );
  if (moved.rows.length === 0) {
    // Lost the race: reload what the winner wrote.
    const latest = (await findRequest(tx, requestId)) as RequestRecord;
    return { kind: 'unchanged', request: latest };
  }

  await tx.query(
    `INSERT INTO request_events (request_id, from_state, to_state, event, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [requestId, current.state, result.to, event, reason],
  );
  // The request is over for shops too: pings still waiting become NO_REPLY, in this same transaction.
  let closedPings: { id: string; ownerUserId: string | null }[] = [];
  if (current.state === 'PINGING') {
    const closed = await tx.query<{ id: string; owner_user_id: string | null }>(
      `UPDATE pings p SET state = 'NO_REPLY'
         FROM shops s
        WHERE p.request_id = $1 AND p.state IN ('QUEUED', 'SENT') AND s.id = p.shop_id
        RETURNING p.id, s.owner_user_id`,
      [requestId],
    );
    closedPings = closed.rows.map((r) => ({ id: r.id, ownerUserId: r.owner_user_id }));
  }
  const updated = (await findRequest(tx, requestId)) as RequestRecord;
  return { kind: 'applied', request: updated, from: current.state, event, reason, closedPings };
}

/** One log line per transition: ids and states only, never the query text or the location. */
export function logTransition(logger: Logger, result: ApplyResult): void {
  if (result.kind !== 'applied') return;
  logger.info(
    {
      requestId: result.request.id,
      from: result.from,
      to: result.request.state,
      event: result.event,
      ...(result.reason && { reason: result.reason }),
    },
    'request transition',
  );
}

/** Applies one event in its own transaction and logs the transition after it commits. */
export async function applyEvent(
  deps: { db: Database; logger: Logger; events?: EventPublisher | undefined },
  requestId: string,
  event: RequestEvent,
  reason: TransitionReason | null = null,
): Promise<ApplyResult> {
  const result = await withTransaction(deps.db, (tx) => applyEventIn(tx, requestId, event, reason));
  logTransition(deps.logger, result);
  announceTransition(deps.events, result, deps.logger);
  return result;
}

/** Live requests whose deadline has passed, oldest first. */
export async function findOverdueRequestIds(db: Queryable, limit = 100): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM requests
      WHERE state IN ('PINGING', 'ANSWERED') AND expires_at <= now()
      ORDER BY expires_at LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

/**
 * Live requests that are old enough for their fan-out job to have run but have no ping at all:
 * the job was lost (Redis restart, instance asleep). The sweeper queues the job again.
 */
export async function findUnpingedRequestIds(
  db: Queryable,
  olderThanSeconds = 30,
  limit = 100,
): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM requests r
      WHERE r.state = 'PINGING' AND r.expires_at > now()
        AND r.created_at < now() - make_interval(secs => $1::double precision)
        AND NOT EXISTS (SELECT 1 FROM pings p WHERE p.request_id = r.id)
      ORDER BY r.created_at LIMIT $2`,
    [olderThanSeconds, limit],
  );
  return rows.map((r) => r.id);
}
