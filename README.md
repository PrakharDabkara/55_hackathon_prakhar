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
