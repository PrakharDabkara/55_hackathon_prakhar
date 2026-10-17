# KahanMilega

> "Where will I find it?" Ask your neighbourhood for an item and see which nearby shops have it, and at what price.

**Status:** Day 3 (deploy skeleton). API serves `/health` and `/ready`; deploys to Render on merge to main. See [docs/BRIEF.md](docs/BRIEF.md) for the full plan.

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

## Development

```sh
npm install
cp .env.example .env     # then adjust if a port is taken
npm run db:up            # Postgres (PostGIS + pgvector) and Redis
npm run db:migrate
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration # needs Docker (Testcontainers)
npm run dev -w @kahanmilega/api   # build and run the API on PORT (needs .env)
```

Deploys and rollbacks: [docs/runbook.md](docs/runbook.md).

Architecture decisions are in [docs/adr/](docs/adr/).

## Try the shop app

Open **https://kahanmilega-api.onrender.com/app/shop** on a phone (the free server sleeps when idle, so the first load can take a minute).

1. Enter any Indian mobile number, tap **OTP bhejo**, then **Demo OTP bharein** (Demo mode: no SMS is sent) and **Login karein**.
2. The first time, give the shop a name, pick 1 or 2 categories and tap **Meri location use karein**.
3. Questions from customers appear on the card by themselves. Tap **Haan hai** (add a price if you like) or **Nahi hai**.

To make a question appear, create a customer request from a terminal; the commands are in [docs/runbook.md](docs/runbook.md#send-a-test-question-to-a-shop). ## Try the customer app

Open **https://kahanmilega-api.onrender.com/app/** (the shop app is at `/app/shop`). The free server sleeps when idle, so the first load can take a minute.

1. Log in with any Indian mobile number: **OTP bhejo**, **Demo OTP bharein**, **Login karein**.
2. Tap **Demo location (Indore)**, type `chini` (or `aata`, `namak`), optionally add a price you have seen, and tap **Dhoondho**.
3. Pins and rows appear as shops answer. For answers without real shopkeepers, run the simulator from your laptop (one admin phone must be set in `ADMIN_PHONES` on the server, see [the runbook](docs/runbook.md#run-the-simulator-against-the-live-site)):

```sh
npm run simulate -- --target https://kahanmilega-api.onrender.com --admin-phone 98xxxxxxxx --count 200 --speed 10 --centre 22.7196,75.8577
```

Run the shop app locally with `npm run dev -w @kahanmilega/web` (API on port 3000).

## Try an errand

An errand is a whole task ("chai banane ka saaman") instead of one item. The agent finds every item across nearby shops and gives you two plans: **Kam dukaan** (fewest shops) and **Sabse sasta** (least money), with a route on a map.

1. Start the stack (`npm run db:up`, `npm run db:migrate`, `npm run seed:catalog`) and the API with `LLM_PROVIDER=gemini` and a key in `.env` (the fake model cannot plan a real task).
2. Start the simulator so shops answer: `npm run simulate -- --target http://localhost:3000 --admin-phone 9876500099 --count 150 --speed 10` (the API needs `ADMIN_PHONES=9876500099`).
3. Open `http://localhost:3000/app/`, log in with Demo mode, tap **Poora kaam batao** (or go to `/app/errand`).
4. Tap an example or write a task, tap **Demo location (Indore)**, tap **Plan banao**.
5. Watch the progress list. If the agent asks a question, answer it. When the plan is ready, switch between the two tabs, then tap **Raasta kholo** to open the route in Google Maps.

No Gemini key? `FAKE_LLM_SCENARIO=e2e/errand-scenario.json` with `LLM_PROVIDER=fake` plays a fixed errand (one question, chai patti, adrak, doodh); `npm run test:e2e` uses it. See the runbook.

## Use KahanMilega from Claude

An MCP server lets an AI assistant look for an item near you, ask shops, and plan a route, using your own customer login. It talks to the public API only (ADR-0023). Six tools: `resolve_item`, `find_item_nearby`, `ask_shops` (pings real shops), `get_request_status`, `close_request`, `plan_route`.

1. Build it and log in (the live site by default; Node 24 and `npm install` first):

```sh
npm run mcp:build
npm run mcp:login -- --phone 9876543210   # any customer number; prints only "logged in"
```

The login is saved in `apps/mcp-server/.kahanmilega-login.json` (git-ignored, readable only by you). Use a customer number, not a shop's. To point at another server, set `KAHANMILEGA_API_URL` (for example `http://localhost:3000`) for both commands and for the server.

2. Connect it. **Claude Code**, from the repository folder:

```sh
claude mcp add kahanmilega -- node "$(pwd)/apps/mcp-server/dist/main.js"
```

**Claude Desktop**: add this to `claude_desktop_config.json` (use your real path) and restart the app:

```json
{
  "mcpServers": {
    "kahanmilega": {
      "command": "node",
      "args": ["/absolute/path/to/kahanmilega/apps/mcp-server/dist/main.js"]
    }
  }
}
```

3. Try it. With the simulator running (see above) so shops answer, ask:

- "Find milk near the demo location (22.7196, 75.8577) under ₹60."
- "Ask shops for chini near 22.7196, 75.8577 and tell me the cheapest."
- "Plan a route to the 3 cheapest shops from there."

`ask_shops` pings real shops, so your assistant should ask before using it; it should use `find_item_nearby` first.

To look at the tools without an assistant, use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector): `npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js`. Tests: `npm run test:integration` includes a contract test that starts the API on a throwaway database and calls every tool through the SDK.
