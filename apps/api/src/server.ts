import webPush from 'web-push';
import { createApp } from './app.js';
import { createLogger } from './logger.js';
import { createMemoryStore, createRedisStore } from './http/ipLimit.js';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
import { aiFromConfig } from './modules/ai/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { registerShutdown } from './shutdown.js';
import { connect } from './workers/redis.js';
import { startWorkers } from './workers/index.js';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
// createPool logs an idle client dying (Neon suspending after idle, a restart) instead of crashing.
const pool = createPool(config.databaseUrl, logger);

const realtime = createRealtime({ redisUrl: config.redisUrl, logger });
// The sign-in limits count in Redis so every instance shares them; if Redis is away they count in
// this process instead, never not at all (ADR-0058).
const limitRedis = config.redisUrl
  ? connect(config.redisUrl, logger, { maxRetriesPerRequest: 1, commandTimeout: 1000 })
  : null;
const ipLimitStore = limitRedis
  ? createRedisStore(limitRedis, createMemoryStore())
  : createMemoryStore();
const ai = aiFromConfig({ config, db: pool, logger });
const workers = startWorkers({
  config,
  db: pool,
  logger,
  events: realtime.events,
  ai,
  subscribe: realtime.onPublish,
  webPush,
});
// Once, at startup: push is optional and never stops the API from starting (ADR-0034).
if (!config.vapid) {
  logger.warn(
    'web push is off: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto:) to turn it on',
  );
} else if (!workers) {
  logger.warn('web push is off: it needs the workers (WORKERS_ENABLED and REDIS_URL)');
}
const app = createApp({
  config,
  logger,
  db: pool,
  realtime,
  ai,
  ipLimitStore,
  ...(workers && { requestHooks: workers.hooks }),
  ...(workers?.errands && { errandHooks: { enqueue: workers.errands.enqueue } }),
});
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, sha: config.gitSha }, 'api listening');
});

registerShutdown({
  server,
  // Open event streams would hold server.close open until the shutdown timeout.
  drain: [realtime.drain],
  closeables: [
    ...(workers ? [workers] : []),
    realtime,
    ...(limitRedis ? [{ close: async () => void limitRedis.disconnect() }] : []),
    { close: async () => ai.close() },
  ],
  pool,
  logger,
});
