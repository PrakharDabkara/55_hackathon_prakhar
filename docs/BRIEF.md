# KahanMilega — Product Brief & Build Plan

Oct 12, 2026 · Prakhar · Source of truth for the hackathon build. Working name; final name decided later.

## Summary

KahanMilega ("where will I find it?") lets a person ask their neighbourhood for an item and see, within minutes, which nearby shops have it and at what price. Shops answer a one-tap ping, and their answers become a living inventory that fades as it ages.

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
| MCP server | Any AI assistant → tools `search_nearby`, `create_request`, `get_request_status`, `get_shop_demand` | No LLM inside; plain tools | Contract tests per tool |

- **Safety:** shop and user text is data, never instructions, so text like "ignore previous instructions" in an item name cannot steer the model.
- **Token metrics:** tokens per search, LLM fallback rate, cache hit rate, cost per 1,000 searches, tracked per release.

## Architecture

One Node.js + TypeScript API, built as a modular monolith, serves every client; slow work runs in workers off Redis queues, and live map updates travel over server-sent events.

- **Clients:** seeker web app (search, map, live answers); shopkeeper web app (pings, one-tap replies); WhatsApp channel (simulated for the demo); MCP server (tools for AI assistants). All call the one API.
- **API modules:** identity, shops, catalog, search, requests, messaging, realtime (SSE), ai, analytics. Modules import only each other's public index.
- **Behind the API:** workers (fan-out pings, expiry, end-of-day digest); Postgres + PostGIS + pgvector (shops, stock, requests, distance queries, embeddings); Redis (cache, job queues via BullMQ, live events via pub/sub); Claude API (understands queries and shop replies).
- **Around it:** GitHub Actions CI/CD, Docker, AWS, OpenTelemetry logs, metrics and traces.

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
  .github/workflows/     # CI and deploy
  CLAUDE.md
  README.md
  CHANGELOG.md
```

## Decisions (each becomes an ADR)

| Decision | Choice | Why |
| --- | --- | --- |
| Architecture | Modular monolith | One deployable, clear module boundaries, split later if needed |
| Cloud | AWS: one EC2 instance running Docker Compose (API, workers, Postgres with PostGIS and pgvector, Redis, Caddy for HTTPS); images built in GitHub Actions | Real cloud and CI/CD skills, low cost, supports long-lived SSE connections. After the hackathon: managed database and Redis, then containers behind a load balancer |
| API framework | Express | Already known, so learning time goes to scaling and AI |
| Login | Phone OTP, simulated (code shown in the dev log) | Real flow without SMS cost |
| Models | Claude Haiku 5.5 for query and reply parsing and the digest; Sonnet 5.5 only if evals show Haiku falls short | Cheapest model that passes the evals |
| Embeddings | OpenAI text-embedding-3-small, stored in pgvector | Anthropic has no embeddings API; no extra database |

## Build plan (17 days; Oct 30 is buffer)

Phases end at gates; nothing moves on until the gate passes. If a gate slips, phase-2 features are cut, never tests or deployment.

- Foundations (Day 1–3) → gate: CI green, app live on AWS
- Marketplace (Day 4–8) → gate: end-to-end demo with simulated shops
- AI layer (Day 9–12) → gate: evals pass in CI
- Harden (Day 13–15) → gate: load targets met
- Ship (Day 16–17) → submit

- [ ] Day 1 · Setup: repo, README, CLAUDE.md, ADRs, PR template; copy Claude Code session logs; telemetry on
- [ ] Day 2 · CI and data: GitHub Actions (lint, types, unit tests); local Docker Compose with Postgres (PostGIS, pgvector) and Redis; schema and migrations; first geo-query tests
- [ ] Day 3 · Cloud skeleton: AWS account with IAM user and billing alert; EC2 with Docker Compose and HTTPS; deploy on every merge to main; structured logs with request IDs. Gate
- [ ] Day 4 · Identity and shops: simulated phone OTP, roles, one-minute shop onboarding (map pin, categories, no catalogue)
- [ ] Day 5 · Catalog and search v1: item list with synonyms; radius search over learned stock
- [ ] Day 6 · Requests: state machine; expiry worker on a Redis queue
- [ ] Day 7 · Fan-out: ping queue, de-duplication, shop ping card (two big buttons, Hindi) with optional price, each yes added to the shop's inventory, duplicate-safe handling
- [ ] Day 8 · Live map and simulator: seeker app with the map over SSE; 500-shop simulator; simulated WhatsApp. Gate
- [ ] Day 9 · Query understanding: cache, synonyms, embedding match in pgvector, LLM fallback; log tokens per call
- [ ] Day 10 · Reply parsing and evals: labeled Hinglish sets, eval runner, accuracy gate in CI
- [ ] Day 11 · Freshness and demand: decay, end-of-day reconfirm, quantity follow-up, busy flag, "anything else?" items via AI, weekly demand message
- [ ] Day 12 · MCP server: 4 tools with contract tests. Gate
- [ ] Day 13 · Security: rate limits, location rounding, input validation, dependency and secret scanning, prompt-injection tests
- [ ] Day 14 · Load: k6 with the simulator against the targets; fix bottlenecks (indexes, caching, connection pools)
- [ ] Day 15 · Operations: traces, metrics, dashboards, alerts, runbook, one labelled incident drill. Gate
- [ ] Day 16 · Story: zero-training test with 3 real shopkeepers; journey website; README, architecture, evals and token reports
- [ ] Day 17 · Demo and submit

## Out of scope for the hackathon

Real WhatsApp messaging, "hold it for me for 30 minutes", search along a route home, payments and shop subscriptions, reliability scores, a native mobile app.