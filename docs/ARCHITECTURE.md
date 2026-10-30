# Overview

AskBuy lets a person ask for an item and see, within minutes, which nearby shops have it and at what price. Shops never keep a catalogue: they answer a one-tap ping, and every answer becomes **learned stock** that fades with age (ADR-0016). The next search for the same item is answered from that memory first; shops are pinged only when fewer than 3 fresh answers exist.

Three layers share one backend: **Find** (one item), **Lists** (a shopping list sorted into items) and **Errand** (an AI agent turns a job like "things for a school project" into a shopping plan across shops). The same tools are offered to outside AI clients through an **MCP server** (ADR-0023).

It is a **modular monolith** (ADR-0001): one Docker service on Render's free tier, with Neon Postgres and Render Key Value (Redis). Total running cost: $0.

## System diagram

```
 Phone / laptop browser (PWA: buyer app /app/, shop app /app/shop, landing /)
        |  HTTPS (JSON + bearer token)         ^  SSE live updates, Web Push
        v                                       |
 Render web service (Docker, Node 24) --------------------------------------
 |  Express 5 API  ->  modules (catalog, requests, lists, errands, orders,   |
 |                     shops, identity, push, realtime, ai, demo, ...)       |
 |  BullMQ workers (same process): expiry sweep, ping fan-out, push,         |
 |                     errand runs, demo autopilot                           |
 |  Static web app (React 19 + Vite build) served by the API                 |
 ---------------------------------------------------------------------------
     |                   |                    |                   |
     v                   v                    v                   v
 Neon Postgres 18    Render Key Value     Google Gemini API    Browser push
 PostGIS, pgvector   (Redis: queues,      (chat/JSON, tools,   services (VAPID)
                     rate limits, events) embeddings)

 GitHub Actions -> tests -> migrate + seed + embed on Neon -> Render deploy hook
 UptimeRobot -> GET /health every 10 min (keeps the free instance warm)
```

## Cost by design ($0 to run)

- **Free tiers, chosen by measurement**: Render web service + Key Value, Neon Postgres, Gemini free tier (ADR-0009, 0020). Upstash was rejected after an idle BullMQ worker measured about 5.18 million commands a month, 10x its free cap (ADR-0010).
- **Fewer AI calls**: learned stock and cheapest-first resolution answer most searches without the model; at most 30 LLM resolutions per user per hour; deploy-time embedding skips unchanged items (source hash).
- **Evals never spend production quota**: a separate Google project, one run at a time, with a per-run call budget.
- **No paid storage**: photos are re-encoded by sharp and kept in Neon (300 MB cap).
- **CI on a $0 GitHub budget**, with Actions minutes capped at zero spend.

## Components

- **API** (`apps/api`, Express 5, Node 24, TypeScript, ESM). Modules under `src/modules/*` talk to each other only through their public `index.ts`.
- **Workers** (`src/workers/*`, BullMQ, inside the API process): request expiry, ping fan-out, push, errand runs, demo autopilot. Every queue keeps finished jobs for 1 hour or 200, failed ones for 7 days (ADR-0064).
- **Web** (`apps/web`, React 19, Vite 8, PWA): buyer app, shop app and landing page, served by the API (ADR-0017). Offline app shell (ADR-0057), Leaflet + OpenStreetMap (ADR-0019), self-hosted fonts, light/dark themes.
- **MCP server** (`apps/mcp-server`): six tools: `resolve_item`, `find_item_nearby`, `ask_shops`, `get_request_status`, `close_request`, `plan_route`.
- **Simulator** (`apps/simulator`) and **demo autopilot**: simulated shops that answer pings, so the demo works with no one at the shop side (ADR-0062).
- **Shared** (`packages/shared`): zod schemas and types used by API, web and MCP.
- **Data**: PostgreSQL 18 + PostGIS 3.6 + pgvector 0.8, 31 migrations. Redis holds queues, rate-limit counters and event fan-out.

## Data flow

**Find**

1. The buyer types a need in everyday words. The resolver runs **cheapest first** (ADR-0021): cache, synonym, trigram, default, embedding, and only then the language model. Unknown real products become new unverified items (ADR-0028).
2. Shops within range with fresh learned stock are returned at once, each with the age of its answer.
3. If fewer than 3 are fresh, open shops of the right kind are pinged (at most 10 per request; a "General store" also covers household, personal-care and stationery basics). The request lives 15 minutes; the deadline is stored in the database and a queue job only makes expiry timely (ADR-0015).
4. Replies arrive over **SSE** (one-time 60 s tickets; events are hints, the client re-reads state, ADR-0018) and show on a list and map. A late reply still teaches stock. A buyer can keep up to 3 searches live.

**List**: a pasted list is sorted by one model call into catalogue items, "other" and refused lines, then asked of shops like a Find; shops tick items on the same parchi (ADR-0055). The plan covers the fewest shops, pickup or delivery per shop.

**Errand** (ADR-0024): our own agent loop calls the model with tools (`resolve_item`, `find_item_nearby`, `ask_shops`, `get_request_status`, `plan_route`, terminal `submit_plan`). State lives in Postgres with a lease, so a crashed run is resumed. The agent can wait for shop replies or ask the buyer a checklist question. **The server decides the truth**: an item is "likely" only if item, shop and unexpired stock exist within 5 km; nothing the agent adds is asked of shops before the buyer confirms (ADR-0049). Caps are configuration, not prompt text: 8 model calls, 20,000 tokens, 10 items, 5 errands per hour per user.

**Order**: pickup or delivery from a reply or plan (ADR-0032, 0039). The shop sees only the item and a rough distance until it accepts; only then the buyer's first name and address. Addresses are cleared 30 days after the order ends (ADR-0033). Web Push notifies both sides (ADR-0034, 0044).

## AI and failure handling

- Models (production): search/list/classify on `gemini-3.1-flash-lite` with fallback `gemini-3.5-flash-lite`; errands on `gemini-3.5-flash-lite` with fallback `3.1`; embeddings `gemini-embedding-001` (768 d), behind a provider port (ADR-0020).
- **Failover from observed errors** (ADR-0065): we captured Google's real error responses (per-minute vs per-day quota ids, retired-model 404s, 503 overload) and replay them in tests. Per-minute limits wait or switch model; a daily limit marks the model exhausted until Google's reset time; a retired model switches permanently.
- **Hedging**: if the primary hasn't answered search/classify in 4 s, the fallback is asked too and the first valid answer wins. Minimal model "thinking" for these short calls. A 15 s cap ends with "assistant busy" (with a reference code), never a wrong "couldn't understand".
- **AI failure never fails a search**: callers degrade to non-AI paths. A circuit breaker skips AI for 60 s after 5 failures.
- **Privacy guard** in the adapter (ADR-0060): every prompt, tool result and embedding text is checked for phone numbers, emails, coordinates and contact fields before it leaves. Buyer and shop text is wrapped as data, never instructions.

## Tech stack

Node 24, TypeScript, Express 5, zod 4 (`strictObject` everywhere), pg + node-pg-migrate, BullMQ + ioredis, pino, sharp (re-encodes uploads, strips EXIF/GPS), web-push, @google/genai, @modelcontextprotocol/sdk, React 19, Vite 8, Leaflet. Tests: Vitest 4, Testing Library, supertest, Testcontainers, Playwright + axe. Hosting: Render (web + Key Value) and Neon (ADR-0009). CI/CD: GitHub Actions, actions pinned to commit SHAs.

## APIs

JSON, bearer-token auth, no cookies, no CORS (ADR-0059). Strict schemas (unknown fields are a 400). Errors are `{error:{code,message,requestId}}`, and the 6-character request id appears in every log line and on screen.

- Auth/account: `/auth/otp/request`, `/auth/otp/verify`, `/account/*` (logout everywhere, delete).
- Buyer: `/items/resolve`, `/search`, `/requests`, `/photos`, `/lists`, `/errands`, `/orders`, `/pickups`, `/route/plan`, `/events` (SSE).
- Shop: `/shops/me/*`, `/pings/:id/answer`, `/list-pings/:id/answer`; both roles use `/push`.
- Operations: `/health`, `/client-errors`, `/admin/*` (404 unless the admin token matches).

## Security and quality

- Demo login: simulated OTP readable only for allowlisted demo numbers (ADR-0058); hashed OTPs and session tokens; per-IP and per-user rate limits; security headers and CSP; exact-host allowlist for push endpoints (SSRF); an authorization test walks every `:id` route.
- Tests on main CI (run of Oct 29): 3,217 unit, 1,280 integration, 118 end-to-end (Playwright with accessibility checks).
- Evals in CI: the resolve gate runs on a held-out set written before any run (≥85% accuracy, 100% injection resistance, 0 nonsense matches); last gated run 88.5%, passed. Errand agent dev eval: 92.3% on the primary model.

## Key technical decisions

| ADR              | Decision                                                          |
| ---------------- | ----------------------------------------------------------------- |
| 0001             | Modular monolith with enforced module boundaries                  |
| 0009             | Free-tier hosting (Render + Neon) instead of AWS                  |
| 0015             | Database deadline is the truth; the queue only accelerates expiry |
| 0016             | Late answers still teach inventory (learned stock)                |
| 0018             | SSE with one-time tickets; events are hints                       |
| 0020             | LLM provider port, Gemini free tier                               |
| 0021             | Cheapest-first resolution, LLM last                               |
| 0022, 0027       | Eval gates in CI for resolve and the errand agent                 |
| 0023             | One tool registry for the in-app agent and the MCP server         |
| 0024, 0049       | Own agent loop; the server, not the model, decides what is true   |
| 0058, 0059, 0060 | Demo login allowlist, API hardening, privacy guard                |
| 0061             | Agent development rules enforced by hooks, not prompts            |
| 0063             | One request id from screen to logs                                |
| 0064             | Keep-awake pinger and bounded queue retention                     |
| 0065             | Model failover built from observed errors                         |
