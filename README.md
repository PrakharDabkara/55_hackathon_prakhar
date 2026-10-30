# AskBuy (working name KahanMilega, which is why the URL says kahanmilega)

> "Where will I find it?" Ask your neighbourhood for an item and see which nearby shops have it, and at what price.

**Live app:** https://kahanmilega-api.onrender.com/ (buyer at `/app/`, shop at `/app/shop`). It runs on a free tier, so the first load can take about 15 s while the server wakes up.

## Try it in 60 seconds

Best on a phone, or on a desktop use the **Open buyer + shop side by side** button in the notice that appears.

1. **Buyer:** open `/app/`, enter `9000000208` (or `9000000209`), tap **OTP bhejo**. Demo mode shows the login code on screen; tap **Demo OTP bharein**, then **Login karein**.
2. Tap **Demo location (Indore)**, type `chini` (or `aata`, `namak`) and tap **Dhoondho**.
3. **Shop:** in a second window open `/app/shop` and log in with `9000000110` the same way. The question appears on the shop's card; tap **Haan hai** (add a price if you like) and watch the pin and price appear on the buyer's map.

The simulated demo shops also answer by themselves within a few seconds (ADR-0062). Details of every screen: [Try the shop app](#try-the-shop-app) and [Try the customer app](#try-the-customer-app) below.

## Problem

Shoppers visit stores only to find an item unavailable, and cannot compare local prices. A bottle-cleaning brush cost ₹200 on a quick-commerce app and ₹50 at a local shop, but finding that shop meant guessing and asking around. Most local shops (kiranas, hardware, stationery, electricals) have no catalogue online.

## How it works

1. You type or speak a need ("gehun ka aata 5 kilo"); it is understood into an item and a shop category.
2. Shops within 2 km that said yes to this item before are shown at once, with how old that answer is.
3. If fewer than 3 shops are found, up to 10 nearby shops get a one-tap ping: "Haan hai" or "Nahi hai", optionally with a price.
4. Each yes appears live on your map with distance, price, freshness and a busy flag.
5. Every yes teaches the system what that shop stocks, and the knowledge fades as it ages. No catalogue to maintain.

## Alternatives and how we differ

Others have reached the same problem, which confirms it is real (checked Oct 12, 2026).

| Product                                                                                              | What it does                                                      | How we differ                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Closebuy](https://play.google.com/store/apps/details?id=com.iamjr15.closebuy&hl=en_US)              | You post a need by text, voice or photo; nearby shops send offers | We remember answers with freshness, so most searches need no ping; demand insights; MCP tools |
| [NearStock](https://www.nearstock.in/)                                                               | Search nearby shops' stock that shopkeepers keep updated          | We ask shops live instead of relying on them to maintain a catalogue                          |
| [NearSt](https://www.retail-systems.com/rs/Google_NearSt_Partnership_Local_Shopping_Search.php) (UK) | Reads stock from shops' billing systems and feeds Google search   | Works for shops with no billing system                                                        |

## Where to look

| What                                  | Where                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture and cost by design       | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                                                                                         |
| Decisions (68 ADRs)                   | [docs/adr/](docs/adr/)                                                                                                                                               |
| Product brief and plan                | [docs/BRIEF.md](docs/BRIEF.md)                                                                                                                                       |
| How we used AI tooling                | [docs/ai-tooling.md](docs/ai-tooling.md), [CLAUDE.md](CLAUDE.md), [.claude/hooks](.claude/hooks), [.claude/agents](.claude/agents), [.claude/skills](.claude/skills) |
| Evals and the held-out gate           | [docs/evals.md](docs/evals.md)                                                                                                                                       |
| What fails and what the user sees     | [docs/failure-modes.md](docs/failure-modes.md)                                                                                                                       |
| Free-tier limits and judge-day budget | [docs/limits.md](docs/limits.md)                                                                                                                                     |
| Deploy, rollback, operations          | [docs/runbook.md](docs/runbook.md)                                                                                                                                   |
| Day-by-day build log                  | [docs/journey/](docs/journey/)                                                                                                                                       |
| CI, deploy and eval workflows         | [ci.yml](.github/workflows/ci.yml), [evals.yml](.github/workflows/evals.yml)                                                                                         |
| Ops and probe scripts                 | [scripts/ops/](scripts/ops/), [scripts/probe/](scripts/probe/)                                                                                                       |

## Tests

Unit (Vitest), integration (Testcontainers on real Postgres and Redis), Playwright end-to-end with axe accessibility scans, AI evals with a held-out gate, and tests for the Claude Code hooks. About 4,600 automated tests run on every push; see [docs/evals.md](docs/evals.md) for the eval gates.

## Development

```sh
npm install
cp .env.example .env     # then adjust if a port is taken
npm run db:up            # Postgres (PostGIS + pgvector) and Redis
npm run db:migrate
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration # needs Docker (Testcontainers)
npm run dev -w @askbuy/api   # build and run the API on PORT (needs .env)
```

Deploys and rollbacks: [docs/runbook.md](docs/runbook.md).

Architecture decisions are in [docs/adr/](docs/adr/). Why the product is called AskBuy, and what still carries the old name: [docs/naming.md](docs/naming.md).

## Try the shop app

Open **https://kahanmilega-api.onrender.com/app/shop** on a phone (the free server sleeps when idle, so the first load can take a minute).

1. Enter the public demo shop number `9000000110`, tap **OTP bhejo**, then **Demo OTP bharein** (Demo mode: no SMS is sent) and **Login karein**.
2. If the shop is not set up yet, give it a name, pick 1 or 2 categories and tap **Meri location use karein**.
3. Questions from customers appear on the card by themselves. Tap **Haan hai** (add a price if you like) or **Nahi hai**.

To make a question appear, create a customer request from a terminal; the commands are in [docs/runbook.md](docs/runbook.md#send-a-test-question-to-a-shop).

## Try the customer app

Open **https://kahanmilega-api.onrender.com/app/** (the shop app is at `/app/shop`). The free server sleeps when idle, so the first load can take about 15 s.

1. Log in with the public demo buyer number `9000000208` or `9000000209` (any other number gets no readable code on screen): **OTP bhejo**, **Demo OTP bharein**, **Login karein**.
2. Tap **Demo location (Indore)**, type `chini` (or `aata`, `namak`), optionally add a price you have seen, and tap **Dhoondho**.
3. Pins and rows appear as shops answer. For answers without real shopkeepers, run the simulator from your laptop (`ADMIN_TOKEN` must be set on the server and exported on your laptop, see [the runbook](docs/runbook.md#run-the-simulator-against-the-live-site)):

```sh
ADMIN_TOKEN=<the server's token> npm run simulate -- --target https://kahanmilega-api.onrender.com --count 200 --speed 10 --centre 22.7196,75.8577
```

Run the shop app locally with `npm run dev -w @askbuy/web` (API on port 3000).

## Try an errand

An errand is a whole task ("chai banane ka saaman") instead of one item. The agent finds every item across nearby shops and gives you two plans: **Kam dukaan** (fewest shops) and **Sabse sasta** (least money), with a route on a map.

1. Start the stack (`npm run db:up`, `npm run db:migrate`, `npm run seed:catalog`) and the API with `LLM_PROVIDER=gemini` and a key in `.env` (the fake model cannot plan a real task).
2. Start the simulator so shops answer: `npm run simulate -- --target http://localhost:3000 --count 150 --speed 10` (the API and the simulator both need the same `ADMIN_TOKEN`, 32+ characters).
3. Open `http://localhost:3000/app/`, log in with Demo mode, tap **Poora kaam batao** (or go to `/app/errand`).
4. Tap an example or write a task, tap **Demo location (Indore)**, tap **Plan banao**.
5. Watch the progress list. If the agent asks a question, answer it. When the plan is ready, switch between the two tabs, then tap **Raasta kholo** to open the route in Google Maps.

No Gemini key? `FAKE_LLM_SCENARIO=e2e/errand-scenario.json` with `LLM_PROVIDER=fake` plays a fixed errand (one question, chai patti, adrak, doodh); `npm run test:e2e` uses it. See the runbook.

## Use AskBuy from Claude

An MCP server lets an AI assistant look for an item near you, ask shops and plan a route, using your own customer login. It talks to the public API only (ADR-0023) and offers six tools: `resolve_item`, `find_item_nearby`, `ask_shops` (pings real shops), `get_request_status`, `close_request` and `plan_route`.

```sh
npm run mcp:build
npm run mcp:login -- --phone 9000000208   # prints only "logged in"
claude mcp add askbuy -- node "$(pwd)/apps/mcp-server/dist/main.js"
```

Setup for Claude Desktop, the MCP Inspector and example prompts: [apps/mcp-server/README.md](apps/mcp-server/README.md). A contract test calls every tool through the SDK (`npm run test:integration`).

## License

All rights reserved. See [LICENSE](LICENSE).
