import type { Logger } from 'pino';
import type { Config } from '../config/config.js';
import type { Database } from '../db/queryable.js';
import type { AiContext } from '../modules/ai/index.js';
import {
  createErrandWaker,
  limitsFromConfig,
  runErrand,
  sweepErrands,
  type ErrandWaker,
} from '../modules/errands/index.js';
import { sweepOrders } from '../modules/orders/index.js';
import { sweepPhotos } from '../modules/photos/index.js';
import type { EventPublisher, RealtimeEvent } from '../modules/realtime/index.js';
import type { RequestHooks } from '../modules/requests/index.js';
import { startErrandWorker, type ErrandWorker } from './errandWorker.js';
import { startPingFanout, type PingFanout } from './pingFanout.js';
import { startRequestExpiry, type RequestExpiry } from './requestExpiry.js';

const PHOTO_SWEEP_EVERY_MS = 10 * 60_000;

export interface Workers {
  /** Hand to createApp so new requests schedule expiry and queue their ping fan-out. */
  hooks: RequestHooks;
  expiry: RequestExpiry;
  fanout: PingFanout;
  /** Present when AI is configured; hand its `enqueue` to createApp as errandHooks. */
  errands: ErrandWorker | null;
  close(): Promise<void>;
  /** Wakes waiting errands when their requests change; null without AI. */
  waker: ErrandWaker | null;
}

/** Starts every background worker inside this process, or returns null when they are switched off. */
export function startWorkers({
  config,
  db,
  logger,
  events,
  sweepEveryMs,
  ai,
  subscribe,
}: {
  config: Config;
  db: Database;
  logger: Logger;
  /** Realtime hints for pings sent and requests expired by the workers. */
  events?: EventPublisher;
  sweepEveryMs?: number;
  /** Models for the errand agent. Without it no errand worker starts. */
  ai?: AiContext;
  /** Registers a listener for every event this process publishes (realtime.onPublish). */
  subscribe?: (listener: (event: RealtimeEvent) => void) => void;
}): Workers | null {
  if (!config.workersEnabled || !config.redisUrl) return null;

  const fanout = startPingFanout({
    redisUrl: config.redisUrl,
    db,
    logger,
    config: { maxPings: config.maxPingsPerRequest, dedupeMinutes: config.pingDedupeMinutes },
    ...(events && { events }),
  });
  const limits = limitsFromConfig(config);
  let lastPhotoSweep = 0;
  // The errand worker is made after the expiry sweeper, which needs to sweep errands too.
  let errands: ErrandWorker | null = null;
  const requestHooks: RequestHooks = {};
  const expiry = startRequestExpiry({
    redisUrl: config.redisUrl,
    db,
    logger,
    enqueueFanout: fanout.enqueue,
    ...(events && { events }),
    ...(sweepEveryMs !== undefined && { sweepEveryMs }),
    extraSweeps: [
      // Photos 7 days past their request's expiry go; looked at every 10 minutes, not every 60 s.
      async () => {
        if (Date.now() - lastPhotoSweep < PHOTO_SWEEP_EVERY_MS) return 0;
        lastPhotoSweep = Date.now();
        return (await sweepPhotos({ db, logger }, new Date())).deleted;
      },
      // A shop that did not answer an order in 10 minutes: expire it and tell the customer.
      () => sweepOrders({ db, logger, events }),
      async () =>
        errands
          ? sweepErrands({
              db,
              logger,
              enqueue: errands.enqueue,
              events,
              requests: requestsContext(),
            })
          : 0,
    ],
  });
  requestHooks.scheduleExpiry = expiry.schedule;
  requestHooks.enqueueFanout = fanout.enqueue;

  /** How the agent opens and closes requests: with the real fan-out and expiry hooks. */
  function requestsContext() {
    return {
      db,
      logger,
      config: {
        minStockResults: config.minStockResults,
        ttlMinutes: config.requestTtlMinutes,
        trigramThreshold: config.trigramThreshold,
      },
      hooks: requestHooks,
      events,
      ai,
    };
  }

  let waker: ErrandWaker | null = null;
  if (ai) {
    errands = startErrandWorker({
      redisUrl: config.redisUrl,
      logger,
      run: (errandId) =>
        runErrand(
          {
            db,
            logger,
            ai,
            limits,
            trigramThreshold: config.trigramThreshold,
            // 15 requests a minute on the free tier: a call every 4 s stays under it.
            paceMs: config.llmProvider === 'gemini' ? 4000 : 0,
            modelRetries: config.llmProvider === 'gemini' ? 3 : 1,
            enqueue: (id, options) => (errands as ErrandWorker).enqueue(id, options),
            events,
            requests: requestsContext(),
          },
          errandId,
        ),
    });
    waker = createErrandWaker({
      db,
      logger,
      limits,
      enqueue: errands.enqueue,
      events,
    });
    // The existing post-commit request.updated publish wakes waiting errands (debounced).
    subscribe?.((event) => {
      if (event.type === 'request.updated')
        waker?.onRequestUpdated((event.data as { requestId: string }).requestId);
    });
  }

  return {
    hooks: requestHooks,
    expiry,
    fanout,
    errands,
    waker,
    async close() {
      waker?.close();
      await Promise.all([expiry.close(), fanout.close(), errands?.close()]);
    },
  };
}
