import { pino } from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';
import { createPool } from './db/pool.js';
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
const workers = startWorkers({ config, db: pool, logger, events: realtime.events });

const app = createApp({
  config,
  logger,
  db: pool,
  realtime,
  ...(workers && { requestHooks: workers.hooks }),
});
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, sha: config.gitSha }, 'api listening');
});

registerShutdown({
  server,
  // Open event streams would hold server.close open until the shutdown timeout.
  drain: [realtime.drain],
  closeables: [...(workers ? [workers] : []), realtime],
  pool,
  logger,
});
