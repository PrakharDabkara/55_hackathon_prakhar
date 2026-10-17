# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (evals workflow)

- The `evals` workflow no longer runs on push to `main`; it runs daily at 08:30 UTC on `main`, on the `evals` label and by hand, with a 30-minute timeout and no overlapping runs. The eval runner does a preflight call and stops at once with `QUOTA_EXHAUSTED — rerun after the daily reset` (exit 3) on a daily-quota 429 or three consecutive 429s with a retry hint over 60 s (`modules/ai/quota.ts`; the Gemini adapter keeps `ProviderError.rateLimit`).
- All jobs run on `ubuntu-24.04`; `checkout` v7, `setup-node` v7, `cache` v6, `upload-artifact` v7 (Node 24). Runbook and ADR-0022 note: three Google projects, the schedule, `QUOTA_EXHAUSTED`.

### Added (Day 13)

- Errand agent patience (ADR-0024 amendment): `ask_shops`, `get_request_status` and `ask_user` tools; states `WAITING_FOR_SHOPS`, `NEEDS_INPUT`, `EXPIRED`, `CANCELLED`; wake-up by replies (debounced `request.updated` hook), a timer or the sweeper; maximum wait; `POST /errands/:id/answer` and `POST /errands/:id/cancel`; 15-minute expiry; errand sweeper in the 60 s sweep; the conversation (function calls, thought signatures) persisted in `errand_steps.payload` and rebuilt on resume; `confirmed` plan status backed by a yes in the errand's own requests, with "Confirmed 2 min ago"; progress lines for asking, answers, waiting and questions; `errand.updated` SSE hints; `GET /admin/errands/stats`; migration 012; `realtime.onPublish`.
- Config: `ERRAND_MAX_ASK_SHOPS`, `ERRAND_MAX_QUESTIONS`, `ERRAND_RESUME_AFTER_MS`, `ERRAND_MAX_WAIT_MS`, `ERRAND_ANSWER_TIMEOUT_MS`, `ERRAND_EXPIRY_MS`, `ERRAND_RESUME_DEBOUNCE_MS`.

### Changed (Day 13)

- A run whose lease expired now resumes from the log instead of starting over; `submit_plan` accepts `confirmed`; the agent's system prompt and tool descriptions follow find first, ask shops for thin items, ask the user on a clarification.

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
- Customer app (Day 8b) at `/app/` (the shop app stays at `/app/shop`): login with Demo mode, a search box "क्या चाहिए?" with an optional price seen elsewhere and location (phone, manual, or a labelled "Demo location (Indore)"), a friendly message for an unresolved item, and a results screen with a Leaflet map on OpenStreetMap tiles (green pins for live answers, blue for learned stock, inline SVG, attribution shown), a list with price, saving badge, distance, freshness and a "Raasta" directions link, Sasta / Paas sorting, a status line ("10 dukaanon se poocha · 7 ne haan kaha · 3 ka jawab baaki"), a countdown, live updates over SSE with a 15 s fallback poll and a live dot, and "Ho gaya" to close. ADR-0019.
- API: results carry each shop's `lat` and `lng` (the seeker's own position is never sent to shops); `GET /requests/:id` returns `pingStats {sent, yes, no, pending}`.
- CSP: `img-src` also allows `https://tile.openstreetmap.org`; scripts and styles stay `'self'` only.
- `POST /admin/sim/shops` accepts an optional `categories` list; the simulator has `categories` and `eager` options for tests and demos.
- Playwright end-to-end test (`npm run test:e2e`, `e2e/`) and a separate CI job `e2e`: Postgres, Redis, the API with `ADMIN_PHONES`, five simulated grocery shops, Chromium at 360 px; the screenshot is uploaded as an artifact. Deploy now waits for it.
- Dependencies (approved): `leaflet`, `@types/leaflet`, `@playwright/test`.
- AI query understanding (Day 9, ADR-0020 and ADR-0021): an `LlmProvider` port in `modules/ai` with a Gemini free-tier adapter (`@google/genai`, JSON schema output, temperature 0) and a scripted fake; 8 s timeout, one retry on 429 and 5xx, a circuit breaker per call kind (5 failures, 60 s), and a per-user limit of 30 LLM resolutions per hour (Redis, fails open). AI failure degrades to "unresolved", never to a failed search.
- Migration 008: `ai_calls` (tokens, latency, outcome, request id; no prompt text), `items.embedding vector(768)` with an HNSW cosine index and a source hash, `query_cache`, `suggested_synonyms`, and `search_queries.matched_by` now also `cache`, `embedding`, `llm`.
- Resolution pipeline: cache, exact synonym, trigram, embeddings (`EMBED_THRESHOLD`, `EMBED_MARGIN`), then an LLM shown a shortlist of at most 10 candidates whose answer must name only shortlisted ids; successful answers are cached and LLM matches are queued as suggested synonyms. The query is capped, stripped of control characters and delimited as data. Only query text and catalog names are ever sent.
- API: `422 item_ambiguous` with a question and options from `POST /requests` and `GET /search`; both accept `itemId`. The seeker app shows the question with big option buttons. `GET /admin/ai/stats` (admin only).
- Scripts: `npm run ai:models` (lists the models a key can use), `npm run ai:embed-catalog` (also run by the deploy job when `GEMINI_API_KEY` is set), `npm run eval:resolve` with `evals/resolve.jsonl` (81 labelled queries; reports in `evals/reports/`).
- Config `LLM_PROVIDER` (required in production), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBED_MODEL`, `EMBED_DIM`, `EMBED_THRESHOLD`, `EMBED_MARGIN`. Dependency (approved): `@google/genai`.
- ADR-0011 (product direction: errand agent, shop delivery as stretch), ADR-0012 (npm workspaces monorepo).
- Evals (ADR-0022): `evals/resolve.dev.jsonl` (81 tuning queries), retired `resolve.holdout.jsonl` (v1, 62) and the gating `resolve.holdout.v2.jsonl` (61); `npm run eval:resolve` reports accuracy by category, steps, LLM fallback, tokens, provider p95 and errors per set, retrying failed model calls; the `evals` workflow gates holdout v2 (accuracy ≥ 85 %, injections 100 %, no nonsense resolved, LLM fallback ≤ 40 %, ≤ 3 errors) in a Testcontainers database, on the `evals` label, by hand and on push to `main`; catalog vectors cached in CI; `docs/evals.md`.
- Resolution safety: single-word fuzzy matches must be a typo (edit distance), the query is cut to its first line, and text that reads like an instruction skips the AI steps (`llm_skipped_suspicious`); "light bulb" synonyms; the `glitar` synonym removed.
- Variant defaults as data: `defaultFor` in the catalog seed (pen, bottle, tea, chilli), table `item_defaults`, resolution step `default` after trigram (migration 009).
- `DELETE /admin/ai/cache?q=` removes one cached answer.
- Seeker status line adds the no count ("… 6 ne mana kiya …").

- MCP server (ADR-0023): `apps/mcp-server`, a stdio server over the public API with the user's own seeker token, six tools (`resolve_item`, `find_item_nearby`, `ask_shops`, `get_request_status`, `close_request`, `plan_route`), clear tool errors, and `npm run mcp:build`, `mcp:login` (demo OTP; prints only "logged in") and `mcp:start`. Dependency (approved): `@modelcontextprotocol/sdk`.
- Shared tool registry in `packages/shared/src/tools` (`@kahanmilega/shared/tools`): name, AI-facing description, zod input and output, side-effect and idempotency flags; `toJsonSchema` for the Day 12 agent.
- `POST /route/plan`: shortest order through up to 8 shops by straight-line distance (exact, every order tried).
- `q` is optional on `GET /search` and `POST /requests` when an `itemId` is given.
- README "Use KahanMilega from Claude".
- Errand agent core (ADR-0024): `POST /errands` and `GET /errands/:id` (owner only, with a Hinglish progress list); an own tool-calling loop in `modules/errands` that plans from learned stock only (`resolve_item`, `find_item_nearby`, `plan_route` run in process, plus a terminal `submit_plan`; the user's location is injected by the server) and ends with a checked plan: "likely" only for fresh learned stock, prices and names from the database, a planned route, total and savings against the reference price.
- `LlmProvider.chatWithTools` (Gemini function calling with schemas from the tool registry, scripted turns in the fake adapter, an `errand` row in `ai_calls` per call).
- Migration 010: `errands` (state as text with a CHECK, lease, counters, plan) and `errand_steps` (the step log); guarded state transitions; a per-errand lease so one run works at a time.
- BullMQ queue `errand` (concurrency 1, job id `errand-<id>`); guardrails `ERRAND_MAX_ITEMS`, `ERRAND_MAX_STEPS`, `ERRAND_TOKEN_BUDGET`, `ERRAND_USER_HOURLY_LIMIT`, `ERRAND_TASK_MAX_CHARS`; a task that reads like an instruction is refused (422).
- `npm run errand:smoke` plans real errands against the local database and prints the step logs with tokens.
- `GET /admin/ai/ping` (admin only): a tiny `generateJson` and `chatWithTools` call with the primary and the fallback model, with kind, status and latency per call; runbook section "AI unavailable: troubleshooting".
- `GEMINI_FALLBACK_MODEL`: the attempts after a timeout, 429 or 503 from the primary use a second model (live: `gemini-3.5-flash-lite`); the log and `ai_calls.model` say which model answered.
- `ERRAND_AI_TIMEOUT_MS` (default 30000): errand model calls get their own time limit; resolve calls keep 8 s.

### Fixed

- Nonsense such as "xyzzy plugh" was resolved to a plug top by trigram overlap and then by the model; the trigram and embedding steps now need real words, and the prompt says random letters are not a typo.
- The "Dukaandaar hain? Yahan jaayein" link overlapped the OTP button on the seeker login (an inline link given button padding); checked at 360 px by a browser test.

- A database connection lost while idle (Neon suspending after idle, a Postgres restart: code 57P01) no longer crashes the process: every pool comes from `createPool`, which logs the code and message (never the credentials) and lets the pool reconnect; `withTransaction` survives a connection lost between two queries. Integration tests close the pool, wait for Postgres to see the connections go, then stop the container (this had failed CI on `main` after PR #12).

- Catalog: removed 36 ambiguous generic terms ("clip", "pen", "switch", "powder" and others; listed in the PR) and added a paper clips item; trigram search no longer guesses for a generic word or a near-tie between items; re-seeding deletes terms dropped from the file.

- `/health` reported `sha: unknown` on Render: the Dockerfile default `GIT_SHA=unknown` shadowed `RENDER_GIT_COMMIT`. Blank/`unknown` now count as unset.
- AI failures are logged with `purpose`, `model`, `attempt`, `kind` (timeout, http, network, invalid_output, breaker, other), `status`, `code`, `latencyMs` and a short sanitised `message`; `ai_calls.outcome` stores the same kind (migration 011 replaces `error` and `skipped_breaker`). A timeout is now retried. Circuit breakers are per purpose.

### Changed

- Cached AI answers carry the catalog version and expire (30 days; 1 day for "nothing fits"); a changed seed file retires them all. Migration 009 deletes the cached "xyzzy plugh" and any trigram entry.
- The seeker map refits whenever pins change (a pin turning from learned to live, or moving), so every answered shop is in view.
- Install scripts of `@google/genai`, `cpu-features`, `msgpackr-extract`, `protobufjs` and `ssh2` are denied in `allowScripts` (reasons in the runbook); `npm ci` prints no warning.
- BRIEF: Day 10 is "Evals as a CI gate"; reply parsing moved to Later.

- BRIEF: three-layer summary, Errand flow, errand/order states, agent AI row, agent metrics, 18-day build plan with scope frozen Oct 15, "Later" list.
- Hosting moved from AWS EC2 to free tiers (Render, Neon); BRIEF cloud row and Day 3 updated; ADR-0002 marked superseded.
- Node 24 LTS (`.nvmrc`, CI, `engines`) and Testcontainers 12.x; versions recorded in ADR-0008.
- BRIEF: Errand flow marks what Day 12 built and what Day 13 adds; the Models row now says the errand agent runs on Gemini behind the provider port.
- Runbook: how to run and watch an errand; the free-tier privacy rule now names the shop data the errand agent sends.
