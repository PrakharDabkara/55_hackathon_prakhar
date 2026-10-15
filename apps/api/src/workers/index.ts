import type { Logger } from 'pino';
import type { Config } from '../config/config.js';
import type { Database } from '../db/queryable.js';
import type { RequestHooks } from '../modules/requests/index.js';
import { startPingFanout, type PingFanout } from './pingFanout.js';
import { startRequestExpiry, type RequestExpiry } from './requestExpiry.js';

export interface Workers {
  /** Hand to createApp so new requests schedule expiry and queue their ping fan-out. */
  hooks: RequestHooks;
  expiry: RequestExpiry;
  fanout: PingFanout;
  close(): Promise<void>;
}

/** Starts every background worker inside this process, or returns null when they are switched off. */
export function startWorkers({
  config,
  db,
  logger,
  sweepEveryMs,
}: {
  config: Config;
  db: Database;
  logger: Logger;
  sweepEveryMs?: number;
}): Workers | null {
  if (!config.workersEnabled || !config.redisUrl) return null;

  const fanout = startPingFanout({
    redisUrl: config.redisUrl,
    db,
    logger,
    config: { maxPings: config.maxPingsPerRequest, dedupeMinutes: config.pingDedupeMinutes },
  });
  const expiry = startRequestExpiry({
    redisUrl: config.redisUrl,
    db,
    logger,
    enqueueFanout: fanout.enqueue,
    ...(sweepEveryMs !== undefined && { sweepEveryMs }),
  });

  return {
    hooks: { scheduleExpiry: expiry.schedule, enqueueFanout: fanout.enqueue },
    expiry,
    fanout,
    async close() {
      await Promise.all([expiry.close(), fanout.close()]);
    },
  };
}
