import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import type { AiContext } from '../ai/index.js';
import type { EventPublisher } from '../realtime/index.js';
import { closeRequest, getRequestStatus, type RequestsContext } from '../requests/index.js';
import { listLinks, type RequestLink } from './persistence.js';

/** The requests module as the errand agent uses it: only its public index (CLAUDE.md rule). */

export interface BridgeDeps {
  db: Database;
  logger: Logger;
  ai?: AiContext | undefined;
  events?: EventPublisher | undefined;
  /** The real context (with the fan-out hooks) when the server has one. */
  requests?: RequestsContext | undefined;
  trigramThreshold?: number | undefined;
}

/** The context to open requests with. Without a real one, the plain defaults (no fan-out hooks). */
export function requestsContextOf(deps: BridgeDeps): RequestsContext {
  return (
    deps.requests ?? {
      db: deps.db,
      logger: deps.logger,
      config: {
        minStockResults: 3,
        ttlMinutes: 15,
        trigramThreshold: deps.trigramThreshold ?? 0.4,
      },
      ...(deps.ai && { ai: deps.ai }),
      events: deps.events,
    }
  );
}

export interface StatusForModel {
  requestId: string;
  item: { id: string; name: string } | null;
  state: string;
  pingStats: { sent: number; yes: number; no: number; pending: number };
  results: {
    shopId: string;
    name: string;
    distanceM: number;
    pricePaise: number | null;
    source: 'live' | 'learned';
    freshness: string;
  }[];
  expiresAt: string;
}

/** What the model may read about one of its requests: no coordinates, no phones, no user ids. */
export async function statusForModel(
  ctx: RequestsContext,
  userId: string,
  requestId: string,
): Promise<StatusForModel | null> {
  const view = await getRequestStatus(ctx, userId, requestId);
  if (!view) return null;
  return {
    requestId,
    item: view.item ? { id: view.item.id, name: view.item.nameEn } : null,
    state: view.state,
    pingStats: view.pingStats,
    results: view.results.slice(0, 8).map((r) => ({
      shopId: r.shopId,
      name: r.name,
      distanceM: r.distanceM,
      pricePaise: r.pricePaise,
      source: r.source,
      freshness: r.freshness,
    })),
    expiresAt: view.expiresAt.toISOString(),
  };
}

export async function linkedStatuses(
  ctx: RequestsContext,
  userId: string,
  links: RequestLink[],
): Promise<StatusForModel[]> {
  const out: StatusForModel[] = [];
  for (const link of links) {
    const status = await statusForModel(ctx, userId, link.requestId);
    if (status) out.push(status);
  }
  return out;
}

/** Closes every request of the errand that is still open. Closing a finished one changes nothing. */
export async function closeLinkedRequests(
  deps: BridgeDeps,
  userId: string,
  errandId: string,
): Promise<number> {
  const ctx = requestsContextOf(deps);
  const links = await listLinks(deps.db, errandId);
  let closed = 0;
  for (const link of links) {
    try {
      const view = await closeRequest(ctx, userId, link.requestId);
      if (view?.state === 'CLOSED') closed++;
    } catch (error) {
      deps.logger.warn(
        { errandId, requestId: link.requestId, err: error },
        'could not close request',
      );
    }
  }
  return closed;
}
