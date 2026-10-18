import { pino } from 'pino';
import webPush from 'web-push';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
import { aiFromConfig } from './modules/ai/index.js';
import { createRealtime } from './modules/realtime/index.js';
import { registerShutdown } from './shutdown.js';
import { startWorkers } from './workers/index.js';

const config = loadConfig(process.env);
const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
// createPool logs an idle client dying (Neon suspending after idle, a restart) instead of crashing.
const pool = createPool(config.databaseUrl, logger);

const realtime = createRealtime({ redisUrl: config.redisUrl, logger });
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
  closeables: [...(workers ? [workers] : []), realtime, { close: async () => ai.close() }],
  pool,
  logger,
});
