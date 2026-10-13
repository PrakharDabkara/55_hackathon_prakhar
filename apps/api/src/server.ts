import { pino } from 'pino';
import pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';
import { registerShutdown } from './shutdown.js';

const config = loadConfig(process.env);
const logger = pino({ level: config.logLevel });
const pool = new pg.Pool({ connectionString: config.databaseUrl });
// An idle client erroring (e.g. Neon closing a connection) must not crash the process.
pool.on('error', (err) => logger.error({ err }, 'idle database client error'));

const app = createApp({ config, logger, db: pool });
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, sha: config.gitSha }, 'api listening');
});

registerShutdown({ server, pool, logger });
