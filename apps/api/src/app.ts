import express from 'express';
import type { Logger } from 'pino';
import { errorSerializer } from './logger.js';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/config.js';
import { adminHealthRouter, type OpsProbes } from './http/adminHealth.js';
import { clientErrorsRouter } from './http/clientErrors.js';
import { healthRouter } from './http/health.js';
import { createIpLimiter, createMemoryStore, type IpLimitStore } from './http/ipLimit.js';
import { createRouteLimits, ROUTE_RULES, scaleRules } from './http/routeLimits.js';
import { securityHeaders } from './http/securityHeaders.js';
import { errorHandler, notFound } from './http/errors.js';
import { runWithRequestId } from './http/requestContext.js';
import { pickRequestId } from './http/requestId.js';
import { DEFAULT_WEB_DIST, webRouter } from './http/web.js';
import { accountRouter } from './modules/account/index.js';
import { aiAdminRouter, type AiContext } from './modules/ai/index.js';
import { demandRouter } from './modules/demand/index.js';
import { pickupsRouter } from './modules/pickups/index.js';
import { routingRouter } from './modules/routing/index.js';
import { photosRouter } from './modules/photos/index.js';
import { pushRouter } from './modules/push/index.js';
import { errandsAdminRouter, errandsRouter, limitsFromConfig } from './modules/errands/index.js';
import { cacheAdminRouter } from './modules/catalog/index.js';
import { createRealtime, realtimeRouter, type Realtime } from './modules/realtime/index.js';
import { countLiveLists, listsRouter } from './modules/lists/index.js';
import { ordersRouter } from './modules/orders/index.js';
import { createIdentify, identityRouter } from './modules/identity/index.js';
import {
  countActiveRequests,
  requestsRouter,
  type RequestHooks,
} from './modules/requests/index.js';
import { demoRouter } from './modules/demo/index.js';
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
  /** What the admin health details read from the running process (queues, Redis, autopilot). */
  ops?: OpsProbes;
  /** Where the built web app lives. Default: apps/web/dist. */
  webDistDir?: string;
  /** Counts the per-IP and per-user limits. Default: in this process; production passes a Redis one. */
  ipLimitStore?: IpLimitStore;
  /** Tests only: a different budget for the broad per-IP limit. */
  rateLimits?: { apiPerIpPerMinute?: number };
}

/** Every API route, per IP, on top of the tighter limits on the dear ones (ADR-0059). */
export const API_IP_LIMIT_PER_MINUTE = 300;

export function createApp({
  config,
  logger,
  db,
  readyTimeoutMs = 2000,
  requestHooks,
  realtime = createRealtime({ redisUrl: null, logger }),
  ai,
  errandHooks,
  ops,
  webDistDir = DEFAULT_WEB_DIST,
  ipLimitStore = createMemoryStore(),
  rateLimits = {},
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Render is one proxy hop: believe the address it appended to X-Forwarded-For and nothing left of
  // it, so a client cannot choose its own req.ip (the per-IP limits key on it). A bare `true`
  // would trust every hop and let a spoofed header through (ADR-0058).
  app.set('trust proxy', config.trustProxyHops);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = pickRequestId(req.headers['x-request-id']);
        res.setHeader('x-request-id', id);
        return id;
      },
      // Path only: query strings can carry a phone number (/dev/otp-inbox), headers a bearer token.
      // pino-http would otherwise put its own err serializer on req.log, past the redaction.
      serializers: {
        err: errorSerializer,
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
      },
    }),
  );
  // Everything this request starts, in this process, logs with its id (see logger.ts).
  app.use((req, _res, next) => runWithRequestId(String(req.id), next));
  // On every response from here on, errors and 429s included.
  app.use(securityHeaders);
  // Health checks and the static web app are not counted: they cost nothing and a load balancer
  // polls the first. Everything below is the API.
  app.use(healthRouter({ gitSha: config.gitSha, db, logger, readyTimeoutMs }));
  app.use(webRouter({ distDir: webDistDir, logger }));
  app.use(
    createIpLimiter({
      name: 'api',
      max:
        rateLimits.apiPerIpPerMinute ??
        Math.max(1, Math.ceil(API_IP_LIMIT_PER_MINUTE * config.rateLimitScale)),
      windowMs: 60_000,
      store: ipLimitStore,
    }),
  );
  app.use(
    createRouteLimits({
      rules: scaleRules(ROUTE_RULES, config.rateLimitScale),
      store: ipLimitStore,
      identify: createIdentify(db),
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(clientErrorsRouter({ logger }));
  app.use(
    identityRouter({
      db,
      logger,
      otpMode: config.otpMode,
      demoPhones: config.demoPhones,
      publicDemoPhones: {
        shop: config.publicDemoShopPhones,
        seeker: config.publicDemoCustomerPhones,
      },
      inboxOpen: config.otpInboxOpen,
      ipLimits: config.otpIpLimits,
      ipLimitStore,
    }),
  );
  app.use(accountRouter({ db, logger, realtime, demoPhones: config.demoPhones }));
  app.use(realtimeRouter({ db, realtime }));
  // Without ADMIN_TOKEN there is no admin, so these routes are not mounted at all (404).
  if (config.adminToken) {
    app.use(
      simulationRouter({
        db,
        logger,
        realtime,
        adminToken: config.adminToken,
        ...(requestHooks && { hooks: requestHooks }),
      }),
    );
    app.use(
      demoRouter({
        db,
        logger,
        adminToken: config.adminToken,
        capBytes: Math.floor(config.photoStorageCapMb * 1024 * 1024),
        ...(requestHooks && { hooks: requestHooks }),
      }),
    );
    app.use(
      adminHealthRouter({
        db,
        adminToken: config.adminToken,
        gitSha: config.gitSha,
        provider: config.llmProvider,
        ops,
        ai,
      }),
    );
    app.use(aiAdminRouter({ db, adminToken: config.adminToken, ai }));
    app.use(cacheAdminRouter({ db, adminToken: config.adminToken }));
    app.use(errandsAdminRouter({ db, adminToken: config.adminToken }));
  }
  app.use(pushRouter({ db, vapidPublicKey: config.vapid?.publicKey ?? null }));
  app.use(photosRouter({ db, logger, capMb: config.photoStorageCapMb }));
  app.use(shopsRouter({ db, ...(requestHooks && { hooks: requestHooks }) }));
  app.use(demandRouter({ db }));
  app.use(
    pickupsRouter({
      db,
      logger,
      events: realtime.events,
      askAfterMinutes: config.pickupAskAfterMinutes,
    }),
  );
  app.use(routingRouter({ db }));
  app.use(searchRouter({ db, trigramThreshold: config.trigramThreshold, ai, logger }));
  // The customer's three live searches: requests and lists count together, errands do not.
  const activeSearches = async (userId: string) =>
    (await countActiveRequests(db, userId)) + (await countLiveLists(db, userId));
  const requestsContext = {
    db,
    logger,
    activeSearches,
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
    listsRouter({
      db,
      logger,
      config: { maxPings: config.maxPingsPerRequest, trigramThreshold: config.trigramThreshold },
      events: realtime.events,
      activeSearches,
      ...(ai && { ai }),
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
