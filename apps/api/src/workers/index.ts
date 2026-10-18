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
import { sweepOrderAddresses, sweepOrders } from '../modules/orders/index.js';
import { sweepPhotos } from '../modules/photos/index.js';
import {
  createNotifier,
  createPushSender,
  createRateLimiter,
  findSubscription,
  markSubscriptionSuccess,
  removeSubscription,
  type CounterStore,
  type WebPushClient,
} from '../modules/push/index.js';
import type { EventPublisher, RealtimeEvent } from '../modules/realtime/index.js';
import type { RequestHooks } from '../modules/requests/index.js';
import { startErrandWorker, type ErrandWorker } from './errandWorker.js';
import { startPingFanout, type PingFanout } from './pingFanout.js';
import { startPushWorker, type PushWorker } from './pushWorker.js';
import { connect } from './redis.js';
import { startRequestExpiry, type RequestExpiry } from './requestExpiry.js';

const PHOTO_SWEEP_EVERY_MS = 10 * 60_000;
const ADDRESS_SWEEP_EVERY_MS = 60 * 60_000;

export interface Workers {
  /** Hand to createApp so new requests schedule expiry and queue their ping fan-out. */
  hooks: RequestHooks;
  expiry: RequestExpiry;
  fanout: PingFanout;
  /** Present when AI is configured; hand its `enqueue` to createApp as errandHooks. */
  errands: ErrandWorker | null;
  /** Present when VAPID keys are set: sends Web Push after the events that caused it (ADR-0034). */
  push: PushWorker | null;
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
  webPush,
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
  /** The web-push library, or a stand-in in tests. Only used when VAPID keys are set. */
  webPush?: WebPushClient;
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
  let lastAddressSweep = 0;
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
      // Address and pin go 30 days after an order ended (ADR-0033); once an hour is plenty.
      async () => {
        if (Date.now() - lastAddressSweep < ADDRESS_SWEEP_EVERY_MS) return 0;
        lastAddressSweep = Date.now();
        return sweepOrderAddresses({ db, logger });
      },
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

  let push: PushWorker | null = null;
  let pushCounters: ReturnType<typeof connect> | null = null;
  if (config.vapid && webPush && subscribe) {
    const sender = createPushSender({
      store: {
        find: (id) => findSubscription(db, id),
        remove: (id) => removeSubscription(db, id),
        markSuccess: (id) => markSubscriptionSuccess(db, id),
      },
      webPush,
      vapid: config.vapid,
      logger,
    });
    push = startPushWorker({ redisUrl: config.redisUrl, logger, deliver: sender.deliver });
    // The limit's counter must fail fast: a slow Redis lets the push through.
    pushCounters = connect(config.redisUrl, logger, {
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
    });
    const counters = pushCounters;
    const store: CounterStore = {
      incr: (key) => counters.incr(key),
      expire: (key, seconds) => counters.expire(key, seconds, 'NX'),
    };
    const notifier = createNotifier({
      db,
      logger,
      enqueue: push.enqueue,
      limiter: createRateLimiter(store, { max: config.pushMaxPerMinute, windowSeconds: 60 }),
      answerDebounceMs: 3000,
    });
    // The events are published after the commit that caused them, so a push never tells of a rollback.
    subscribe((event) => notifier.handle(event));
  }

  return {
    hooks: requestHooks,
    expiry,
    fanout,
    errands,
    waker,
    push,
    async close() {
      waker?.close();
      await Promise.all([expiry.close(), fanout.close(), errands?.close(), push?.close()]);
      pushCounters?.disconnect();
    },
  };
}
