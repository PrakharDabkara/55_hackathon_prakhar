import { pino } from 'pino';
import pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';
import { registerShutdown } from './shutdown.js';

const config = loadConfig(process.env);
const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
const pool = new pg.Pool({ connectionString: config.databaseUrl });
// An idle client erroring (e.g. Neon closing a connection) must not crash the process.
// Log the message only: pg errors carry the whole client object.
pool.on('error', (err) => logger.error({ reason: err.message }, 'idle database client error'));

const app = createApp({ config, logger, db: pool });
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, sha: config.gitSha }, 'api listening');
});

registerShutdown({ server, pool, logger });
