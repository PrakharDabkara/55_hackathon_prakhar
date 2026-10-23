# ADR-0062: Demo autopilot, seed and reset

Status: accepted. Builds on ADR-0058 (admin token), ADR-0055 (lists) and ADR-0040 (logos).

## Context

The simulated shops ran from the owner's laptop (`apps/simulator`), so with the laptop off nobody
answered a search on the live site. The demo shops (9000000102 to 106) and customers (202 to 206)
were empty, and rehearsing a demo left old requests and orders behind.

## Decision

1. **The API answers for simulated shops itself.** With `DEMO_AUTOPILOT=on` (default `off`) the
   background worker plans an answer for every ping and parchi of a shop with `is_simulated`, and
   moves its orders on (READY for a pickup, out for delivery; it accepts first, never declines).
   Delays are 5 to 90 s, like the simulator.
2. **One set of answer rules.** `decide`, `decideList`, `decideOrder` and the seeded random numbers
   moved from `apps/simulator` to `packages/shared`; both the laptop simulator and the autopilot
   import them. The laptop simulator stays for local development.
3. **Internal calls, not HTTP.** The autopilot calls `answerPing`, `answerListPing` and `shopAct`, the
   functions the routes call. Events only say where to look (a pingId); three finders read the open
   work from the database and return simulated shops only, so a forged or stray event, a real shop
   or a demo shop can never be answered.
4. **Capped.** At most `DEMO_AUTOPILOT_MAX_PER_MINUTE` (30) answers start per minute and at most 200
   timers wait; the rest are simply not answered, like a busy shopkeeper.
5. **Catch-up.** After the free instance wakes, and on every expiry sweep (every 60 s, no new timer),
   it plans what is still open: a request or list inside its time limit, an order still waiting. An
   answer is never planned past the end of its request, and never with under 2 s to spare.
6. **`POST /admin/demo/seed`** (ADMIN_TOKEN, idempotent, under a Postgres advisory lock): five demo
   shops on 9000000102 to 106 around Vijay Nagar, Indore (300 m to 1.5 km apart, two deliver for
   ₹20 and ₹30, three are pickup only), placeholder initials logos through the logo pipeline,
   learned stock for 40 catalog items from `modules/demo/fixtures.ts` (marked illustrative), eight
   simulated shops if fewer exist, and a clearly-demo saved address for customers 202 to 206.
   `users.is_demo` and `shops.is_demo` (migration 030) mark what it makes.
7. **`POST /admin/demo/reset`** (ADMIN_TOKEN): removes requests, lists, errands, orders, pickup visits
   and pings that involve a demo number (101 to 110, 201 to 210), clears the stock demo shops
   learned, then seeds again. It matches on the phone of the customer or shop owner, never on
   `is_demo` alone, so a real customer's request to a real shop is never in the way. It returns
   counts only.
8. **`scripts/demo.sh seed|reset`** posts to the live site with `ADMIN_TOKEN` from the environment,
   through curl's stdin so the token is never in the process list.

## Consequences

- "Demo shop" means a shop owned by a demo number. The eight autopilot shops are `is_simulated` and
  `is_demo`: the autopilot answers them because they are simulated, and a reset leaves them standing
  but forgets what they learned.
- A real customer's order at a demo shop is removed by a reset (the shop is the demo's).
- Reset deletes rows directly instead of calling each module, a deliberate exception to "modules
  talk through their index" for admin maintenance; the module finders are used for everything else.
- **Cost on the free tier (estimate, not measured on Render):** no new timer or process; idle it
  costs three small selects per 60 s sweep while the instance is awake. It does not keep the
  instance awake (timers are not inbound traffic), so Render's 15-minute sleep still applies and
  waking is still the first search's job. A busy minute is capped at 30 answers, each about ten
  queries and a few Redis commands, so a 200-answer demo is a few thousand queries and about a
  thousand Redis commands. No model call is made, so no Gemini quota is spent. Memory is a few
  hundred timers and map entries at most.
- **On production (security review):** the live Render service is the demo, so the flag is allowed
  there on purpose; it logs a warning at startup and only ever answers `is_simulated` shops, which
  only the admin routes create. Never turn it on for a launch with real shops and customers.
- Demo numbers are reserved by decision: seed adopts a user already on one (sets its role, marks it
  demo) and reset removes that number's requests and orders. Do not use 9000000101 to 110 or 201 to
  210 for real people.
- Seed and reset take a try-lock: a second call while one runs gets 409 `demo_busy`. The cap is per
  process (one Render instance); a second instance would double it.
- Rejected: running the laptop simulator on Render (a second process the free tier does not have),
  a new HTTP client inside the API (tokens, rate limits and a network hop for nothing), and
  copying the simulator's rules (two versions would drift).
