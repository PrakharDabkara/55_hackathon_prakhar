import express from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/config.js';
import { healthRouter } from './http/health.js';
import { errorHandler, notFound } from './http/errors.js';
import { pickRequestId } from './http/requestId.js';
import { DEFAULT_WEB_DIST, webRouter } from './http/web.js';
import { aiAdminRouter, type AiContext } from './modules/ai/index.js';
import { demandRouter } from './modules/demand/index.js';
import { pickupsRouter } from './modules/pickups/index.js';
import { routingRouter } from './modules/routing/index.js';
import { photosRouter } from './modules/photos/index.js';
import { pushRouter } from './modules/push/index.js';
import { errandsAdminRouter, errandsRouter, limitsFromConfig } from './modules/errands/index.js';
import { cacheAdminRouter } from './modules/catalog/index.js';
import { createRealtime, realtimeRouter, type Realtime } from './modules/realtime/index.js';
import { ordersRouter } from './modules/orders/index.js';
import { identityRouter } from './modules/identity/index.js';
import { requestsRouter, type RequestHooks } from './modules/requests/index.js';
import { simulationRouter } from './modules/simulation/index.js';
import { searchRouter } from './modules/search/index.js';
import { shopsRouter } from './modules/shops/index.js';
import type { Database } from './db/queryable.js';

interface AppDeps {
  config: Config;
  logger: Logger;
  db: Database;
  readyTimeoutMs?: number;
  requestHooks?: RequestHooks;
  /** Live events. Without it, realtime is off (no Redis): tickets answer 503 and events go nowhere. */
  realtime?: Realtime;
  /** Embeddings and the LLM for item resolution. Without it only the free steps run. */
  ai?: AiContext;
  /** Queues the errand agent. Without it (no Redis) new errands are stored and wait. */
  errandHooks?: {
    enqueue(errandId: string, options?: { delayMs?: number; key?: string }): Promise<void>;
  };
  /** Where the built web app lives. Default: apps/web/dist. */
  webDistDir?: string;
}

export function createApp({
  config,
  logger,
  db,
  readyTimeoutMs = 2000,
  requestHooks,
  realtime = createRealtime({ redisUrl: null, logger }),
  ai,
  errandHooks,
  webDistDir = DEFAULT_WEB_DIST,
}: AppDeps) {
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
      // Path only: query strings can carry a phone number (/dev/otp-inbox), headers a bearer token.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
      },
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(healthRouter({ gitSha: config.gitSha, db, logger, readyTimeoutMs }));
  app.use(webRouter({ distDir: webDistDir, logger }));
  app.use(identityRouter({ db, logger, otpMode: config.otpMode, adminPhones: config.adminPhones }));
  app.use(realtimeRouter({ db, realtime }));
  // Without ADMIN_PHONES there is no admin, so these routes are not mounted at all (404).
  if (config.adminPhones.length > 0) {
    app.use(
      simulationRouter({
        db,
        logger,
        realtime,
        adminPhones: config.adminPhones,
        ...(requestHooks && { hooks: requestHooks }),
      }),
    );
    app.use(aiAdminRouter({ db, adminPhones: config.adminPhones, ai }));
    app.use(cacheAdminRouter({ db, adminPhones: config.adminPhones }));
    app.use(errandsAdminRouter({ db, adminPhones: config.adminPhones }));
  }
  app.use(pushRouter({ db, vapidPublicKey: config.vapid?.publicKey ?? null }));
  app.use(photosRouter({ db, logger, capMb: config.photoStorageCapMb }));
  app.use(shopsRouter({ db, ...(requestHooks && { hooks: requestHooks }) }));
  app.use(demandRouter({ db }));
  app.use(pickupsRouter({ db, logger, askAfterMinutes: config.pickupAskAfterMinutes }));
  app.use(routingRouter({ db }));
  app.use(searchRouter({ db, trigramThreshold: config.trigramThreshold, ai, logger }));
  const requestsContext = {
    db,
    logger,
    config: {
      minStockResults: config.minStockResults,
      ttlMinutes: config.requestTtlMinutes,
      trigramThreshold: config.trigramThreshold,
    },
    ...(requestHooks && { hooks: requestHooks }),
    events: realtime.events,
    ...(ai && { ai }),
  };
  app.use(requestsRouter(requestsContext));
  app.use(
    errandsRouter({
      db,
      logger,
      limits: limitsFromConfig(config),
      ...(errandHooks && { enqueue: errandHooks.enqueue }),
      events: realtime.events,
      requests: requestsContext,
    }),
  );
  app.use(
    ordersRouter({
      db,
      logger,
      limits: limitsFromConfig(config),
      events: realtime.events,
    }),
  );
  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
