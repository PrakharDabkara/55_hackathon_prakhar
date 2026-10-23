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
import { createDemoAutopilot, type DemoAutopilot } from '../modules/demo/index.js';
import { sweepLists } from '../modules/lists/index.js';
import { sweepOrderAddresses, sweepOrders } from '../modules/orders/index.js';
import { sweepPhotos } from '../modules/photos/index.js';
import { sweepPickups } from '../modules/pickups/index.js';
import {
  createNotifier,
  createPushSender,
  createRateLimiter,
  findSubscription,
  markSubscriptionSuccess,
  removeSubscription,
  type CounterStore,
  type Notifier,
  type WebPushClient,
} from '../modules/push/index.js';
import type { EventPublisher, RealtimeEvent } from '../modules/realtime/index.js';
import type { RequestHooks } from '../modules/requests/index.js';
import { createOps } from './ops.js';
import type { OpsProbes } from '../http/adminHealth.js';
import { startDemoAutopilotWorker, type DemoAutopilotWorker } from './demoAutopilot.js';
import { startErrandWorker, type ErrandWorker } from './errandWorker.js';
import { startPingFanout, type PingFanout } from './pingFanout.js';
import { startPushWorker, type PushWorker } from './pushWorker.js';
import { cleanOldJobs } from './jobRetention.js';
import { connect } from './redis.js';
import { startRequestExpiry, type RequestExpiry } from './requestExpiry.js';

const PHOTO_SWEEP_EVERY_MS = 10 * 60_000;
const ADDRESS_SWEEP_EVERY_MS = 60 * 60_000;
const PICKUP_SWEEP_EVERY_MS = 60 * 60_000;

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
  /** Queue depths, Redis and autopilot state for /admin/health/details. */
  ops: OpsProbes;
  /** Wakes waiting errands when their requests change; null without AI. */
  waker: ErrandWaker | null;
  /** Answers for the simulated shops from inside the API; null unless DEMO_AUTOPILOT=on (ADR-0062). */
  demoAutopilot: DemoAutopilot | null;
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
  let lastPickupSweep = 0;
  // Made below with the push worker; without push there are no reminders.
  let notifier: Notifier | null = null;
  // The errand worker is made after the expiry sweeper, which needs to sweep errands too.
  let errands: ErrandWorker | null = null;
  // Only with DEMO_AUTOPILOT=on: event-driven on its own queue, no timer and no sweep (ADR-0062).
  let demoAutopilot: DemoAutopilot | null = null;
  let demoQueue: DemoAutopilotWorker | null = null;
  if (config.demoAutopilot) {
    const autopilot = createDemoAutopilot({
      db,
      logger,
      events,
      queue: {
        enqueue: (job, options) => (demoQueue as DemoAutopilotWorker).enqueue(job, options),
      },
      lists: { maxPings: config.maxPingsPerRequest, trigramThreshold: config.trigramThreshold },
      maxPerMinute: config.demoAutopilotMaxPerMinute,
    });
    demoQueue = startDemoAutopilotWorker({
      redisUrl: config.redisUrl,
      logger,
      run: (job) => autopilot.run(job),
    });
    demoAutopilot = autopilot;
  }
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
      // Lists past their 15 minutes end, and forgotten drafts go (ADR-0055).
      () => sweepLists({ db, logger, events }),
      // A shop that did not answer an order in 10 minutes: expire it and tell the customer.
      () => sweepOrders({ db, logger, events }),
      // Address and pin go 30 days after an order ended (ADR-0033); once an hour is plenty.
      async () => {
        if (Date.now() - lastAddressSweep < ADDRESS_SWEEP_EVERY_MS) return 0;
        lastAddressSweep = Date.now();
        return sweepOrderAddresses({ db, logger });
      },
      // "Le liya?" (ADR-0035): customers a pickup is an hour old for get one push, if the home
      // screen has not asked yet. A no-op without push.
      async () => (notifier ? notifier.remindPickups() : 0),
      // Visits are forgotten 30 days after the tap.
      async () => {
        if (Date.now() - lastPickupSweep < PICKUP_SWEEP_EVERY_MS) return 0;
        lastPickupSweep = Date.now();
        return sweepPickups({ db, logger });
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
  if (demoAutopilot) {
    // New work arrives as events; what the instance missed while asleep is found by the catch-up.
    subscribe?.((event) => demoAutopilot?.onEvent(event));
    // Once, now that the instance is awake: what it missed while asleep. Not a loop.
    void demoAutopilot.catchUp();
    logger.warn(
      { maxPerMinute: config.demoAutopilotMaxPerMinute },
      'demo autopilot is on: simulated shops answer with invented prices',
    );
  }
  requestHooks.scheduleExpiry = expiry.schedule;
  requestHooks.enqueueFanout = fanout.enqueue;
  requestHooks.enqueueShopCatchUp = fanout.enqueueCatchUp;

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
    notifier = createNotifier({
      db,
      logger,
      enqueue: push.enqueue,
      limiter: createRateLimiter(store, { max: config.pushMaxPerMinute, windowSeconds: 60 }),
      answerDebounceMs: 3000,
    });
    // The events are published after the commit that caused them, so a push never tells of a rollback.
    const live = notifier;
    subscribe((event) => live.handle(event));
  }

  // Once at start: clear completed jobs that piled up before retention existed (ADR-0064). Not awaited.
  void cleanOldJobs(
    [
      { queue: fanout.queue },
      { queue: expiry.queue },
      { queue: errands?.queue },
      // Keyed pushes are kept a day on purpose ("once per request"), so this queue waits a day.
      { queue: push?.queue, graceMs: 24 * 3_600_000 },
      { queue: demoQueue?.queue },
    ],
    logger,
  );

  // A short-leashed connection of its own, so a slow Redis cannot hold up /admin/health/details.
  const infoConnection = connect(config.redisUrl, logger, {
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
  });

  return {
    hooks: requestHooks,
    ops: createOps({
      memoryInfo: () => infoConnection.info('memory'),
      queues: {
        'ping-fanout': fanout.queue,
        expiry: expiry.queue,
        errand: errands?.queue,
        push: push?.queue,
        'demo-autopilot': demoQueue?.queue,
      },
      autopilot: demoAutopilot,
    }),
    expiry,
    fanout,
    errands,
    waker,
    push,
    demoAutopilot,
    async close() {
      waker?.close();
      demoAutopilot?.close();
      await Promise.all([
        expiry.close(),
        fanout.close(),
        errands?.close(),
        push?.close(),
        demoQueue?.close(),
      ]);
      pushCounters?.disconnect();
      infoConnection.disconnect();
    },
  };
}
