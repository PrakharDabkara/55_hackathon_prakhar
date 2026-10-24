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
4. **Event-driven, on the existing job queue.** An admin-stream event queues a `plan` job on its own
   BullMQ queue (`demo-autopilot`); the plan decides and queues the answer as a delayed job (5 to
   90 s), and an order's second step (out / ready) as another delayed job. Job ids make a repeated
   event one job. The worker runs three jobs at a time; the catch-up reads at most 25 of each kind
   and queues them 10 at a time. There is no timer, no sweep and no polling loop: idle, the process
   only waits on Redis and never touches the database by itself.
5. **Capped.** At most `DEMO_AUTOPILOT_MAX_PER_MINUTE` (30) answers are planned per minute; the rest
   are simply not answered, like a busy shopkeeper.
6. **Catch-up once, at startup.** After the free instance wakes, one batch scan queues what is still
   open (a request or list inside its time limit, an order still waiting). An answer is never
   planned past the end of its request, and never with under 2 s to spare.
7. **Off means off.** With `DEMO_AUTOPILOT=off` (or unset) the queue, the worker, the event listener
   and the scan are not created at all; no code change, just the variable and a restart. Jobs left
   in Redis from an earlier "on" are inert, and re-check the database if it is turned on again.
8. **`POST /admin/demo/seed`** (ADMIN_TOKEN, idempotent, under a Postgres advisory lock): five demo
   shops on 9000000102 to 106 around Vijay Nagar, Indore (300 m to 1.5 km apart, two deliver for
   ₹20 and ₹30, three are pickup only), placeholder initials logos through the logo pipeline,
   learned stock for 40 catalog items from `modules/demo/fixtures.ts` (marked illustrative), eight
   simulated shops if fewer exist, and a clearly-demo saved address for customers 202 to 206.
   `users.is_demo` and `shops.is_demo` (migration 030) mark what it makes.
9. **`POST /admin/demo/reset`** (ADMIN_TOKEN): removes requests, lists, errands, orders, pickup visits
   and pings that involve a demo number (101 to 110, 201 to 210), clears the stock demo shops
   learned, then seeds again. It matches on the phone of the customer or shop owner, never on
   `is_demo` alone, so a real customer's request to a real shop is never in the way. It returns
   counts only.
10. **`scripts/demo.sh seed|reset`** posts to the live site with `ADMIN_TOKEN` from the environment,
    through curl's stdin so the token is never in the process list.

## Consequences

- "Demo shop" means a shop owned by a demo number. The eight autopilot shops are `is_simulated` and
  `is_demo`: the autopilot answers them because they are simulated, and a reset leaves them standing
  but forgets what they learned.
- A real customer's order at a demo shop is removed by a reset (the shop is the demo's).
- Reset deletes rows directly instead of calling each module, a deliberate exception to "modules
  talk through their index" for admin maintenance; the module finders are used for everything else.
- **Cost, measured** (`npm run perf:autopilot`: the API as its own process on this machine with
  real Postgres and Redis; off against on, five customers searching every 3 to 5 s for 90 s, one
  list, one order; three runs off, two valid runs on; a third "on" run failed on OTP limits in the
  harness and is left out). Free-tier Render has less CPU than this machine, so read the figures as
  differences, not absolutes.

  |                                 | off                         | on                                            |
  | ------------------------------- | --------------------------- | --------------------------------------------- |
  | idle CPU (one core)             | 0.07 %                      | 0.17 %                                        |
  | busy CPU                        | 1.25 to 1.30 %              | 1.31 to 1.49 %                                |
  | busy memory (RSS)               | 153 to 162 MB, peak 167     | 121 to 156 MB, peak 157                       |
  | customer search p50 / p95 / p99 | 13 / 48 to 56 / 69 to 75 ms | 13 to 14 / 45 to 47 / 54 to 61 ms             |
  | answers                         | none                        | 11 and 17 pings, the list, the order to READY |

  Added: about 0.1 % of a core idle and about 0.1 to 0.2 % busy; no measurable memory (within the
  run-to-run spread of about 10 MB); search latency is not slower (p95 is inside the off spread).
  Idle database use (corrected Oct 24; the first count looked only at `statement:` log lines and
  missed parameterised `execute` lines): an idle API runs about 10 queries per 70 s window with the
  autopilot off (one 60 s sweep: requests, lists, orders, errands) and 14 on. The extra 4 are the
  hourly and 10-minute sweeps (photos, order addresses, pickups) running once at start-up, not the
  autopilot, which adds none. So about 10 queries a minute, around the clock, while the API is
  awake: enough to keep Neon from suspending (ADR-0064). It uses Redis idle (the
  queue's blocking wait), as the other workers do. It does not keep the instance awake by itself, so
  Render's 15-minute sleep applies unless the ADR-0064 pinger runs. No model call is made, so no Gemini quota is spent.

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
