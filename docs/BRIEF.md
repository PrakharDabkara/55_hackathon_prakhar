# KahanMilega — Product Brief & Build Plan

Oct 12, 2026 · Prakhar · Source of truth for the hackathon build. Working name; final name decided later.

## Summary

KahanMilega ("where will I find it?") lets a person ask their neighbourhood for an item and see, within minutes, which nearby shops have it and at what price. Shops answer a one-tap ping, and their answers become a living inventory that fades as it ages.

KahanMilega works in three layers: Find (ask nearby shops for an item), Plan (an AI errand agent takes a whole task — 'things for my son's school project' — finds every item across shops and returns a shopping plan with a route), and Get (stretch: the shop itself delivers, cash on delivery). The agent is the product's centre: it saves the user the running around.

- **Problem:** shoppers often visit stores only to find items unavailable, and have no way to compare local prices. Personal case: a bottle-cleaning brush cost ₹200 on a quick-commerce app and ₹50 at a local shop, but finding that shop meant guessing and asking around.
- **For:** people new to a city, people with an urgent need, and anyone price-conscious. On the other side, local shops (kiranas, hardware, stationery, electricals) that never put a catalogue online.
- **Hackathon goal:** a working, deployed slice built through the full SDLC by Oct 30, 2026. An AI judge scores how AI was used and how well the product is built; uniqueness is not required.

## Users and positioning

We win on items and prices that quick commerce does not carry well, by asking shops instead of asking them to maintain a catalogue.

| User | Job to be done | What they get |
| --- | --- | --- |
| Seeker | Find an item nearby without calling five shops | Shops that have it, distance, quoted price, how fresh the answer is |
| Shopkeeper | Get walk-in customers without listing a catalogue | Walk-in customers from one-tap replies; no catalogue to maintain |

| Alternative | What it does | Why it leaves a gap |
| --- | --- | --- |
| Quick commerce (Blinkit, Instamart) | Common items in minutes from dark stores | Higher prices, no local shops, narrow range |
| [IndiaMART BuyLeads](https://help.indiamart.com/knowledge-base/how-to-consume-buyleads-in-indiamart) | Broadcasts a buyer's requirement to suppliers | B2B, slow, not live or nearby |
| [ONDC](https://inc42.com/features/quick-commerce-eats-ondc-lunch-koshy-ceo) | Asked shops to list catalogues on an open network | Retail orders fell from 6.5M a month (Oct 2024) to 4.6M (Feb 2025) |
| [Milo](https://liliputing.com/milo-android-app-shows-if-items-are-in-stock-at-nearby-stores/) (US) | Showed in-stock items at nearby stores | Needed store system integrations Indian shops do not have |

**Closest products (checked Oct 12, 2026).** Two Indian builders reached the same problem independently, which confirms it is real; neither shows traction yet.

| Product | What it does | How we differ |
| --- | --- | --- |
| [Closebuy](https://play.google.com/store/apps/details?id=com.iamjr15.closebuy&hl=en_US) | You post a need by text, voice or photo; nearby shops send offers to compare. 50+ downloads, updated June 30, 2026 | We remember answers with freshness, so most searches need no ping; demand insights for shops; measured AI cost; MCP tools |
| [NearStock](https://www.nearstock.in/) | Search nearby shops' stock that shopkeepers keep updated; still being built | We ask live instead of relying on shops to maintain a catalogue |
| [NearSt](https://www.retail-systems.com/rs/Google_NearSt_Partnership_Local_Shopping_Search.php) (UK) | Reads stock from shops' billing systems and feeds Google search | Works for shops with no billing system |

The README names these products and how we differ (never claim "no one offers this").

**The emotional edge, framed honestly.** The distributors' body AICPDF [alleges about 2 lakh kirana closures](https://bwdisrupt.com/article/quick-commerce-boom-forces-over-two-lakh-kirana-stores-to-close-alleges-aicpdf-537848) due to quick commerce; Zepto [disputes the impact](https://retail4growth.com/viewpoints/zepto-says-qc-not-impacting-kiranas-but-whats-the-real-scenario-1239). So we claim only what we measure: customers sent to local shops, rupees saved by users, and demand shown to shops.

**Business model (after the hackathon):** 10 free search appearances for a shop, then ₹100 a month. A "was it actually there?" rating from users stops paid shops from saying yes just for footfall.

## Core flows

A search answers from remembered stock first and pings shops only for what is missing, which keeps pings, messaging cost and shopkeeper fatigue low. Numbers below are starting defaults, tuned after the first load test.

**Seeker**

1. The user types or speaks a need ("bottle cleaning brush", "gehun ka aata 5 kilo"). The query is understood into an item and a shop category.
2. Shops within 2 km that said yes to this item before are listed at once, with how old that answer is.
3. If fewer than 3 shops are listed, up to 10 of the nearest shops in that category are pinged. A shop gets at most one ping per item per 30 minutes.
4. Shops reply yes or no, optionally with a quoted price, in the app or over WhatsApp (simulated in the hackathon build).
5. Each yes appears live on the user's map with distance, quoted price, freshness and a busy flag, so the user can skip a crowded shop.
6. The request expires after 15 minutes; shops that did not reply are recorded.
7. Later: the user answers "was it actually there?", which feeds a shop reliability score.

**Shopkeeper**

1. Onboards in under a minute: phone number (simulated OTP), shop name, map pin, one or two categories. No catalogue.
2. Gets a ping ("Do you have a bottle-cleaning brush?") and taps Yes or No, optionally with a price.
3. On a yes, the item joins the shop's inventory automatically, with one optional follow-up: "Roughly how many: a few or plenty?"
4. Now and then: "Anything else you want customers to find?" The AI turns a free-text answer into items.
5. One tap marks the shop busy; the flag clears itself after 30 minutes.
6. One end-of-day message: "Still have these? Reply with the numbers you ran out of."
7. Later: a weekly message of what people nearby asked for, with no dashboard to learn.

**Errand (AI agent)**

1. The user describes a task in Hindi, English or Hinglish.
2. The agent turns it into items (name, quantity, category, budget if given). If the task is too vague, it asks the user one question.
3. For each item it checks learned stock first, then pings shops for what is missing (using the same request/ping system as Seeker search).
4. While replies arrive it adjusts: widens the radius, tries another category, suggests a substitute, or looks for cheaper.
5. It returns a plan: which shop for which items, prices, total, route order. Every item is marked "confirmed" (a shop said yes in this errand) or "likely" (learned stock only). It never claims stock no shop confirmed.
6. Stretch: "Want me to order this?" Only on the user's yes, the shop gets a delivery request (cash on delivery) and can accept or decline; on decline the plan falls back to pickup.

**Zero-training rule.** A shopkeeper installs the app and is using it at once, with no explanation, demo or class. Every shop screen must pass that test:

- The main screen is one ping card: the item, and two big buttons, "Haan hai" and "Nahi hai".
- Hindi by default, other languages selectable; voice input wherever typing is asked.
- No menus, settings or forms after onboarding; the first real ping is the tutorial.
- Acceptance test: a first-time shopkeeper installs, onboards and answers a ping, unaided, in under 60 seconds. Check it with three real shopkeepers before the demo.

## Domain model

A request is a small state machine, and every ping inside it has its own lifecycle; both are pure logic, so they are the first things built test-first.

Request states and transitions:

- `OPEN` → `ANSWERED` when 3 or more shops already have the item in learned stock
- `OPEN` → `PINGING` when too few shops have it in stock
- `PINGING` → `ANSWERED` on the first yes
- `PINGING` → `EXPIRED` after 15 minutes with no yes
- `ANSWERED` → `CLOSED` when the user is done, or after 15 minutes

Errand states:

- `PLANNING` → `NEEDS_INPUT` (asks the user) → `PLANNING`
- `PLANNING` → `WAITING_FOR_SHOPS` → `PLANNING` (resumed by replies or a timeout)
- `PLANNING` → `PLAN_READY`
- any → `EXPIRED` (15 min) or `CANCELLED`

Order states (stretch):

- `REQUESTED` → `ACCEPTED` | `DECLINED` | `EXPIRED` (10 min)
- `ACCEPTED` → `OUT_FOR_DELIVERY` → `DELIVERED`
- `REQUESTED` / `ACCEPTED` → `CANCELLED`

The agent is durable: errand state lives in Postgres; a BullMQ job resumes the agent when replies arrive or a timer fires, so no LLM call is held open while waiting.

Ping states: `QUEUED` → `SENT` (worker sends) → `YES` | `NO` | `NO_REPLY` (shop taps, or timeout).

| Stock type | Created by | Shown to the user as | Fades after (starting default) |
| --- | --- | --- | --- |
| Learned | A shop's yes to any past ping, plus an optional "a few or plenty" | "Had it 2 days ago" | 7 days, sooner if "a few"; reset by the end-of-day check |
| Live | A yes to the current request | "Confirmed 10 min ago" | When the request closes |

Inventory is built in reverse: every search teaches the system what each shop stocks, so the shops people actually ask about fill in first.

## AI components

Every AI step tries the cheapest path first and calls the LLM only when cheaper paths fail, so token cost per search is a product metric we can drive down and chart.

| Component | Input → output | Cheapest path first | How it is checked |
| --- | --- | --- | --- |
| Query understanding | "gehun ka aata 5 kilo" → item: wheat flour, qty 5 kg, category: grocery | Cache → synonym dictionary → embedding match → LLM only below a similarity threshold | Labeled Hinglish query set; category accuracy gate in CI |
| Reply parsing | "haan hai, 450 ka" → yes, ₹450 | Buttons (no AI) → pattern rules → LLM fallback | Labeled reply set; accuracy gate in CI |
| Demand digest | Week of request counts → a 3-line summary for the shop | One batched call per shop per week | Every number in the summary must match the counts exactly |
| Errand agent | Task → shopping plan | Claude Haiku 5.5 tool-use loop (Sonnet 5.5 only if agent evals fail); our own loop on the Messages API, no agent framework; tools `search_nearby`, `get_learned_stock`, `create_request`, `get_request_status`, `plan_route`; guardrails (starting defaults): max 10 items, 15 shops pinged, 12 LLM steps, a per-errand token budget, 15-minute limit | Eval set of 20 errands |
| MCP server | Any AI assistant → tools `search_nearby`, `get_learned_stock`, `create_request`, `get_request_status`, `plan_route` | No LLM inside; plain tools | Contract tests per tool |

- **Safety:** shop and user text is data, never instructions, so text like "ignore previous instructions" in an item name cannot steer the model.
- **Token metrics:** tokens per search, LLM fallback rate, cache hit rate, cost per 1,000 searches, tracked per release.

## Architecture

One Node.js + TypeScript API, built as a modular monolith, serves every client; slow work runs in workers off Redis queues, and live map updates travel over server-sent events.

- **Clients:** seeker web app (search, map, live answers); shopkeeper web app (pings, one-tap replies); WhatsApp channel (simulated for the demo); MCP server (tools for AI assistants). All call the one API.
- **API modules:** identity, shops, catalog, search, requests, messaging, realtime (SSE), ai, analytics. Modules import only each other's public index.
- **Behind the API:** workers (fan-out pings, expiry, end-of-day digest); Postgres + PostGIS + pgvector (shops, stock, requests, distance queries, embeddings); Redis (cache, job queues via BullMQ, live events via pub/sub); Claude API (understands queries and shop replies).
- **Around it:** GitHub Actions CI/CD, Docker, free-tier hosting (Render, Neon; ADR-0009; AWS after the hackathon), OpenTelemetry logs, metrics and traces.

The web app is a React PWA with Leaflet maps on OpenStreetMap tiles. Logs are structured JSON (pino) with a request ID on every line, and the same ID follows a search through its pings, replies and map updates.

## Non-functional targets

Starting targets for the hackathon build, checked by load tests and tuned after the first run.

| Area | Target |
| --- | --- |
| Scale | 500 simulated shops in one city area; 60 searches a minute sustained |
| Search latency | p95 under 300 ms when learned stock answers |
| Ping delivery | p95 under 2 s from search to the shop's screen |
| Live map | A shop's yes reaches the user's map within 1 s |
| Privacy | User location rounded to about 500 m before shops see it; shops see the item and a distance band only |
| Security | Login, roles (seeker, shop, admin), per-user and per-shop rate limits, webhook signature checks, input validation, secrets outside code, dependency and secret scanning in CI |
| Reliability | Duplicate messages handled once (idempotency keys), retries with backoff, a dead-letter queue, clean expiry of requests |

## Testing strategy

Tests come first: Prakhar writes the acceptance criteria, the test commit lands before the implementation commit, and CI blocks a merge on any failing layer.

| Layer | What it covers | Tool |
| --- | --- | --- |
| Unit | Ranking, freshness decay, request state machine, ping de-duplication, price parsing | Vitest |
| Integration | Geo queries on PostgreSQL/PostGIS, queues and cache on Redis, run against real containers | Testcontainers |
| Contract | Messaging channels (in-app, simulated WhatsApp) and each MCP tool | Vitest |
| End-to-end | Search → ping → reply → pin on the map, in a real browser | Playwright |
| Load | The non-functional targets above, driven by the shop simulator | k6 |
| Evals | Query understanding and reply parsing on labeled Hinglish sets, with accuracy gates | Custom runner in CI |

**Shop simulator.** 500 fake shops with a realistic mix of categories, reply probability, reply delay, price spread, and a few unreliable shops. It powers the load tests and the live demo, so the demo never depends on real shopkeepers.

## Metrics

| Group | Metric | Source |
| --- | --- | --- |
| Product | Searches that ended at a local shop | Request outcomes |
| Product | Rupees saved (quoted local price vs a reference online price) | Shop replies |
| Product | Time to first yes; shop reply rate | Request events |
| System | p95 latency per endpoint, error rate, queue lag | OpenTelemetry metrics |
| AI | Tokens per search, LLM fallback rate, cache hit rate, cost per 1,000 searches | LLM call logs |
| AI | Eval accuracy per release | CI eval runs |
| AI | Errand success rate (plan covers every item, confirmed or likely) | Agent eval runs |
| AI | Tool-call correctness | Agent eval runs |
| AI | Tokens and cost per errand; steps per errand | LLM call logs |
| AI | Time to plan | Errand events |
| Build process | Tokens and cost per merged PR, cache-read share, edits accepted vs rejected | Claude Code telemetry and local session logs |

"Dev hours saved" is shown only as a labelled estimate, never as a measurement.

## Repo structure

```
kahanmilega/
  apps/
    api/                 # Node.js + TypeScript (Express) server
      src/modules/       # identity, shops, catalog, search, requests,
                         # messaging, realtime, analytics, ai
      src/workers/       # fan-out, expiry, end-of-day digest
    web/                 # React PWA for seekers and shopkeepers
    mcp-server/          # MCP tools over the public API
    simulator/           # 500 fake shops for demo and load tests
  packages/shared/       # types and validation schemas
  evals/                 # labeled sets + runner
  load/                  # k6 scripts
  infra/                 # Dockerfiles, compose, deploy config
  docs/
    BRIEF.md             # this file
    ARCHITECTURE.md
    adr/                 # one file per decision
    runbook.md
    evals.md
    journey/             # daily What/How/Why/Learn log
  .github/workflows/     # CI and deploy
  CLAUDE.md
  README.md
  CHANGELOG.md
```

## Decisions (each becomes an ADR)

| Decision | Choice | Why |
| --- | --- | --- |
| Architecture | Modular monolith | One deployable, clear module boundaries, split later if needed |
| Cloud | Free tier (ADR-0009): Render (API, Docker), Neon (Postgres with PostGIS and pgvector), Redis per ADR-0010, Cloudflare Pages (web); CD from GitHub Actions. Replaces the AWS EC2 plan (ADR-0002) | Real deploy and CI/CD at zero cost. AWS (ECS, RDS, ElastiCache, CloudFront) is the post-hackathon target |
| API framework | Express | Already known, so learning time goes to scaling and AI |
| Login | Phone OTP, simulated (code shown in the dev log) | Real flow without SMS cost |
| Models | Claude Haiku 5.5 for query and reply parsing, the digest and the errand agent; Sonnet 5.5 only if evals show Haiku falls short | Cheapest model that passes the evals |
| Embeddings | OpenAI text-embedding-3-small, stored in pgvector | Anthropic has no embeddings API; no extra database |
| Runtime and data | Node 24 LTS; PostgreSQL 18 + PostGIS 3.6 + pgvector 0.8.x; Redis 8.8 | Node 20 is end of life; the Postgres 17 image cannot install pgvector via apt (ADR-0008) |

## Build plan (18 days; Oct 30 is buffer)

Phases end at gates; nothing moves on until the gate passes. Scope is frozen as of Oct 15. New ideas go to the Later list, not the build.

- Foundations (Day 1–3) → gate: CI green, app live on Render
- Marketplace (Day 4–8) → gate: end-to-end demo with simulated shops
- AI and agent (Day 9–14) → gate: agent evals pass in CI
- Harden and ship (Day 15–18); Oct 30 is buffer

- [x] Day 1 · Setup: repo, README, CLAUDE.md, ADRs, PR template; copy Claude Code session logs; telemetry on
- [x] Day 2 · CI and data: GitHub Actions (lint, types, unit tests); local Docker Compose with Postgres (PostGIS, pgvector) and Redis; schema and migrations; first geo-query tests
- [x] Day 3 · Cloud skeleton: Render + Neon free tier (ADR-0009); `/health` and `/ready`; Docker image; deploy on every merge to main; structured logs with request IDs. Gate
- [ ] Day 4 (Oct 15) · Identity and shops: simulated OTP, sessions, roles, shop onboarding API
- [ ] Day 5 (Oct 16) · Catalog and search v1: items with synonyms; radius search over learned stock
- [ ] Day 6 (Oct 17) · Requests: state machine; expiry worker on a Redis queue
- [ ] Day 7 (Oct 18) · Fan-out: ping queue, de-duplication, shop ping card, each yes added to learned stock
- [ ] Day 8 (Oct 19) · Live map and simulator: seeker app with map over SSE; 500-shop simulator. Gate
- [ ] Day 9 (Oct 20) · Query understanding: cache, synonyms, embeddings in pgvector, LLM fallback; tokens logged per call
- [ ] Day 10 (Oct 21) · Reply parsing and eval runner; accuracy gates in CI
- [ ] Day 11 (Oct 22) · MCP server: the 5 tools with contract tests
- [ ] Day 12 (Oct 23) · Errand agent v1: task → items, tool-use loop, guardrails; tested with a fake LLM
- [ ] Day 13 (Oct 24) · Durable agent: errand state in Postgres, resume on replies/timeouts, ask-the-user step, plan and route on the map
- [ ] Day 14 (Oct 25) · Agent evals: 20 errands; success, tool correctness, tokens per errand; gate in CI. Gate
- [ ] Day 15 (Oct 26) · Freshness and busy flag; stretch: shop delivery (order state machine, accept/decline, live status)
- [ ] Day 16 (Oct 27) · Security and load: rate limits, location rounding, prompt-injection tests including the agent; k6 against targets
- [ ] Day 17 (Oct 28) · Operations: metrics, dashboards, runbook, one incident drill
- [ ] Day 18 (Oct 29) · Story and submit: README, architecture, eval and token reports, journey website, demo

If a gate slips, cut in this order: shop delivery, freshness extras, load targets. Never tests or deployment.

## Later (not in the hackathon build)

Runner delivery (someone queues at DMart for you), payments and subscriptions, real WhatsApp, weekly demand digest, "anything else you stock?" prompts, reliability scores, search along a route home, hold-it-for-me, native mobile app.
