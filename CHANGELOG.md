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
- Errors answer as `{"error":{"code","message"}}`; request logs drop query strings and headers.
- ADR-0011 (product direction: errand agent, shop delivery as stretch), ADR-0012 (npm workspaces monorepo).

### Fixed

- `/health` reported `sha: unknown` on Render: the Dockerfile default `GIT_SHA=unknown` shadowed `RENDER_GIT_COMMIT`. Blank/`unknown` now count as unset.

### Changed

- BRIEF: three-layer summary, Errand flow, errand/order states, agent AI row, agent metrics, 18-day build plan with scope frozen Oct 15, "Later" list.
- Hosting moved from AWS EC2 to free tiers (Render, Neon); BRIEF cloud row and Day 3 updated; ADR-0002 marked superseded.
- Node 24 LTS (`.nvmrc`, CI, `engines`) and Testcontainers 12.x; versions recorded in ADR-0008.
