# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- npm-workspaces monorepo scaffold (`apps/*`, `packages/*`) per the brief's repo structure.
- Root tooling: TypeScript (strict), ESLint, Prettier, Vitest.
- Docs: README, CLAUDE.md, ADRs 0001–0006, PR template, `.env.example`.
- Local stack: `docker-compose.yml` with Postgres 18 + PostGIS 3.6 + pgvector 0.8.7 (`infra/postgres`) and Redis 8; `npm run db:up`, `db:down`, `db:migrate`.
- Database access with `pg` and `node-pg-migrate` (ADR-0007); migrations for extensions and the `shops` table with a GiST index.
- `findShopsWithinRadius` in the shops module, with a Testcontainers integration test.
- GitHub Actions CI: lint, typecheck, unit and integration tests; `.nvmrc` (Node 20).
- API skeleton: Express app with `GET /health` (liveness, git SHA, uptime) and `GET /ready` (Postgres, 503 if down), zod-validated config that fails fast, pino JSON logs with `x-request-id` reuse and echo, graceful shutdown on SIGTERM.
- `infra/api/Dockerfile` (multi-stage, pinned `node:24.21.0-slim`, non-root) and `.dockerignore`.
- `render.yaml` Blueprint: free Docker web service in Singapore, free Key Value, auto-deploy off.
- CD: `deploy` job in CI on main runs Neon migrations, then the Render deploy hook for the tested commit.
- `apps/api/scripts/redis-idle-worker.ts` Redis command-count experiment.
- ADR-0009 (free-tier hosting, supersedes 0002), ADR-0010 (Render Key Value over Upstash), runbook v1.
- Dependencies: express, pino, pino-http, zod, bullmq, ioredis (BullMQ 6 peer), supertest.
- Identity: phone + simulated OTP login (`/auth/otp/request`, `/auth/otp/verify`, `/auth/logout`, `/dev/otp-inbox`), opaque hashed session tokens, roles, `requireAuth`/`requireRole`; `OTP_MODE` config (ADR-0013); OTP limits hold under concurrency; `OTP_MODE` is required in production.
- Shops: `POST /shops`, `GET` and `PATCH /shops/me`; migration 003 (users, otp_codes, sessions, shop owner and category check).
- `packages/shared`: category and role constants, built to `dist` (Dockerfile builds it).
- Catalog: migration 004 (`items`, `item_synonyms` with a trigram index, `shop_stock`, `search_queries`), a 223-item seed catalog with English, Devanagari and Hinglish synonyms, and `npm run seed:catalog` (run by the deploy job after migrations).
- Item resolution: `normaliseQuery` (filler words, quantities), exact synonym then `pg_trgm` match, every query logged (ADR-0014); `TRIGRAM_THRESHOLD` config.
- Search: `GET /search?q=&lat=&lng=&radius_m=` over learned stock, expired stock excluded, freshest bucket then nearest; `findLearnedStock` in the shops module.
- Requests: pure state machine (OPEN, PINGING, ANSWERED, EXPIRED, CLOSED), migration 005 (`requests`, `request_events`), `POST /requests` (idempotent via `Idempotency-Key`), `GET /requests/:id`, `POST /requests/:id/close`; every transition is one guarded UPDATE plus an audit row.
- Expiry (ADR-0015): database deadline, lazy expiry on read, BullMQ delayed job per request and a 60 s sweeper, started in the API process behind `WORKERS_ENABLED` and closed on shutdown. `MIN_STOCK_RESULTS`, `REQUEST_TTL_MINUTES`, `WORKERS_ENABLED` config; `REDIS_URL` now read.
- Fan-out (Day 7a): migration 006 (`pings`, `requests.target_price_paise`); `onRequestPinging` queues a `ping-fanout` job that picks the nearest shops of the item's category (excluding learned-stock shops), applies a Redis `SET NX EX` dedupe (one ping per shop and item per 30 minutes; skipped and logged if Redis is down) and shows the pings.
- Shop side: `GET /shops/me/pings` (item, quantity, target price, distance band only) and `POST /pings/:id/answer` (once; a yes updates learned stock and answers the request in one transaction). Pings left open when a request ends become `NO_REPLY`; a late answer within 24 h still teaches inventory (ADR-0016).
- Price check: `targetPricePaise` on `POST /requests`; `GET /requests/:id` returns live answers plus learned stock, `?sort=distance|price`, and `savingsPaise` below the target.
- Config `MAX_PINGS_PER_REQUEST`, `PING_DEDUPE_MINUTES`; queue calls give up after 2 s when Redis is away instead of waiting forever.
- Shop web app (Day 7b), `apps/web`: Vite + React + TypeScript served by the API under `/app/` with a strict Content-Security-Policy (ADR-0017). Three screens: login (with a Demo mode box that fills the OTP), onboarding (name, 1-2 category tiles, location), and the ping card ("Haan hai" / "Nahi hai", optional price in rupees sent as integer paise, few/plenty chips). Hindi by default with an English toggle, one dictionary file, polling every 5 s. Minimal PWA manifest and icons.
- Fan-out: when the dedupe refuses a shop the next-nearest is asked instead (up to 3x the cap); the sweeper re-adds a lost fan-out job for requests with no pings after 30 s.
- Dependencies for the web app: react, react-dom, vite, @vitejs/plugin-react, @testing-library/react, @testing-library/user-event, jsdom, and the React type packages.
- Errors answer as `{"error":{"code","message"}}`; request logs drop query strings and headers.
- Realtime (Day 8a, ADR-0018): server-sent events. `POST /events/ticket` gives a random one-time ticket (60 s, stored hashed in Redis); `GET /events?ticket=` opens the stream (heartbeat every 20 s, clean removal on close). Events are hints: `request.updated` to the seeker, `ping.created` and `ping.closed` to the shop. Fan-out through Redis pub/sub with a dedicated subscriber connection, published after the transaction commits.
- Shop app: SSE with a new ticket on each reconnect replaces 5-second polling (30-second fallback poll kept), and a small green "live" dot while connected.
- Shop app: the answer buttons show Devanagari large with Latin small below ("हाँ है" / "Haan hai", "नहीं है" / "Nahi hai"); the quantity chips are asked as "कितना है?" with "थोड़ा बचा है" / "काफ़ी है".
- Admin role: `ADMIN_PHONES` (empty by default, fails closed); a listed phone gets role `admin` on login. Admin endpoints answer 404 to everyone else.
- Migration 007: `items.ref_price_paise` (AI-estimated reference price for all 224 catalog items, seed file v2) and `shops.is_simulated`.
- Simulator endpoints (admin only): `POST /admin/sim/shops`, `DELETE /admin/sim/shops`, `GET /admin/sim/events`.
- `apps/simulator`, `npm run simulate`: fake shops (Node built-ins only) that answer real pings through the real answer endpoint over one admin stream. Runbook: "Run the simulator against the live site".
- Config `ADMIN_PHONES`; `.env.example` and `render.yaml` (no value; set by hand).
- ADR-0011 (product direction: errand agent, shop delivery as stretch), ADR-0012 (npm workspaces monorepo).

### Fixed

- A database connection lost while idle (Neon suspending after idle, a Postgres restart: code 57P01) no longer crashes the process: every pool comes from `createPool`, which logs the code and message (never the credentials) and lets the pool reconnect; `withTransaction` survives a connection lost between two queries. Integration tests close the pool, wait for Postgres to see the connections go, then stop the container (this had failed CI on `main` after PR #12).

- Catalog: removed 36 ambiguous generic terms ("clip", "pen", "switch", "powder" and others; listed in the PR) and added a paper clips item; trigram search no longer guesses for a generic word or a near-tie between items; re-seeding deletes terms dropped from the file.

- `/health` reported `sha: unknown` on Render: the Dockerfile default `GIT_SHA=unknown` shadowed `RENDER_GIT_COMMIT`. Blank/`unknown` now count as unset.

### Changed

- BRIEF: three-layer summary, Errand flow, errand/order states, agent AI row, agent metrics, 18-day build plan with scope frozen Oct 15, "Later" list.
- Hosting moved from AWS EC2 to free tiers (Render, Neon); BRIEF cloud row and Day 3 updated; ADR-0002 marked superseded.
- Node 24 LTS (`.nvmrc`, CI, `engines`) and Testcontainers 12.x; versions recorded in ADR-0008.
