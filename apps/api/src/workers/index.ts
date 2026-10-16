import type { Logger } from 'pino';
import type { Config } from '../config/config.js';
import type { Database } from '../db/queryable.js';
import type { AiContext } from '../modules/ai/index.js';
import { limitsFromConfig, runErrand } from '../modules/errands/index.js';
import type { EventPublisher } from '../modules/realtime/index.js';
import type { RequestHooks } from '../modules/requests/index.js';
import { startErrandWorker, type ErrandWorker } from './errandWorker.js';
import { startPingFanout, type PingFanout } from './pingFanout.js';
import { startRequestExpiry, type RequestExpiry } from './requestExpiry.js';

export interface Workers {
  /** Hand to createApp so new requests schedule expiry and queue their ping fan-out. */
  hooks: RequestHooks;
  expiry: RequestExpiry;
  fanout: PingFanout;
  /** Present when AI is configured; hand its `enqueue` to createApp as errandHooks. */
  errands: ErrandWorker | null;
  close(): Promise<void>;
}

/** Starts every background worker inside this process, or returns null when they are switched off. */
export function startWorkers({
  config,
  db,
  logger,
  events,
  sweepEveryMs,
  ai,
}: {
  config: Config;
  db: Database;
  logger: Logger;
  /** Realtime hints for pings sent and requests expired by the workers. */
  events?: EventPublisher;
  sweepEveryMs?: number;
  /** Models for the errand agent. Without it no errand worker starts. */
  ai?: AiContext;
}): Workers | null {
  if (!config.workersEnabled || !config.redisUrl) return null;

  const fanout = startPingFanout({
    redisUrl: config.redisUrl,
    db,
    logger,
    config: { maxPings: config.maxPingsPerRequest, dedupeMinutes: config.pingDedupeMinutes },
    ...(events && { events }),
  });
  const expiry = startRequestExpiry({
    redisUrl: config.redisUrl,
    db,
    logger,
    enqueueFanout: fanout.enqueue,
    ...(events && { events }),
    ...(sweepEveryMs !== undefined && { sweepEveryMs }),
  });

  const errands = ai
    ? startErrandWorker({
        redisUrl: config.redisUrl,
        logger,
        run: (errandId) =>
          runErrand(
            {
              db,
              logger,
              ai,
              limits: limitsFromConfig(config),
              trigramThreshold: config.trigramThreshold,
              // 15 requests a minute on the free tier: a call every 4 s stays under it.
              paceMs: config.llmProvider === 'gemini' ? 4000 : 0,
            },
            errandId,
          ),
      })
    : null;

  return {
    hooks: { scheduleExpiry: expiry.schedule, enqueueFanout: fanout.enqueue },
    expiry,
    fanout,
    errands,
    async close() {
      await Promise.all([expiry.close(), fanout.close(), errands?.close()]);
    },
  };
}
