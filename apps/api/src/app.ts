import express from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/config.js';
import { healthRouter } from './http/health.js';
import { pickRequestId } from './http/requestId.js';
import type { Queryable } from './modules/shops/index.js';

interface AppDeps {
  config: Config;
  logger: Logger;
  db: Queryable;
  readyTimeoutMs?: number;
}

export function createApp({ config, logger, db, readyTimeoutMs = 2000 }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = pickRequestId(req.headers['x-request-id']);
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  app.use(healthRouter({ gitSha: config.gitSha, db, logger, readyTimeoutMs }));

  return app;
}
