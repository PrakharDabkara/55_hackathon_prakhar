# Runbook (v7)

Hosting is described in [ADR-0009](adr/0009-free-tier-hosting.md). API on Render (Singapore), Postgres on Neon.

## How a deploy works

1. A PR merges to `main`.
2. The `ci` job runs lint, typecheck, unit and integration tests.
3. The `deploy` job (same workflow, `production` environment) runs only if `ci` passed:
   1. `node-pg-migrate up` against Neon, using the `NEON_DIRECT_URL` secret.
   2. A POST to the Render deploy hook (`RENDER_DEPLOY_HOOK_URL`) with `&ref=<commit sha>`, so Render builds exactly the tested commit.
4. Render builds `infra/api/Dockerfile`, starts the container, waits for `GET /health` to return 200, then switches traffic.

Auto-deploy on Render is off. A push alone never deploys.

Manual redeploy: GitHub → Actions → re-run the `deploy` job, or Render dashboard → the service → Manual Deploy.

Migrations run before the new code, so every migration must work with the previous release too (add first, remove later).

## Roll back

Code: Render dashboard → `kahanmilega-api` → Events (or Deploys) → pick the last good deploy → Rollback. It redeploys that image; the next merge to `main` deploys forward again, so revert the bad commit on `main` too.

Database: migrations are not rolled back with the code. If a migration is the problem, write a new forward migration. Neon also keeps point-in-time history for a short window on the free plan (Neon console → Branches → Restore), which is a last resort.

## Where the logs are

- Render dashboard → `kahanmilega-api` → Logs. One JSON object per line (pino).
- Every log line written while a request runs has `requestId`: the `x-request-id` the caller sent or a six-character one we made ("7F3A2C"), echoed in the response header and in every error body. Search it in the Logs filter to follow one request; background jobs the request queued log the same id as `correlationId`.
- Locally: `docker logs <container>` or the terminal running `npm run dev -w @askbuy/api`.

## Debugging a live issue (O1)

1. **Get the ref.** An error on screen ends in "· ref 7F3A2C". Ask for that, plus the time and which screen.
2. **Search the ref in Render logs.** `7F3A2C` shows the request line, the error line (`unhandled error`: `errorClass`, `sqlState`, `constraint`) and any job it queued (`job failed`: `queue`, `jobName`, `attempt`). A crash in the browser itself has no ref: search `client error` (warn) for the route and `appVersion`.
3. **Open `GET /admin/health/details`** with the admin token (`Authorization: Bearer ...`): `db`, `redis`, each queue's `waiting`, `active`, `delayed` and `failedLast24h`, `ai.callsToday`, `ai.failedToday`, `ai.breakerSkipsToday`, `limiter.fallbacksToday` (sign-in limits counted in memory because Redis failed; above 0 means the per-IP limits were split across instances or restarts), `autopilot.on` and `lastActivityAt`, `version.sha`. Counts only.
4. **Common causes.**
   - _Cold start:_ first request after idle is slow or times out; `/health` answers, `/ready` takes a few seconds. Wait a minute and retry; see Free-tier behaviour.
   - _Quota exhausted:_ `ai.failedToday` or `breakerSkipsToday` climbing, `/admin/ai/ping` says 429 or `RESOURCE_EXHAUSTED`. Searches fall back to the free steps; see AI unavailable below. It clears at the provider's daily reset.
   - _Runner offline / queues stuck:_ `waiting` grows and `active` stays 0, or `redis.ok` is false. Check Redis on Render, restart the API; jobs are kept.
   - _Autopilot off:_ demo shops never answer and `autopilot.on` is false. Set `DEMO_AUTOPILOT=on` and redeploy; `lastActivityAt` should move within a minute of a request.
   - _Wrong build:_ `version.sha` is not the commit you expect; the deploy has not finished or failed.
5. **Still unclear:** reproduce with the ref's route, then read the `sqlState` against the PostgreSQL error codes table.

## What the probes mean

| Endpoint      | Meaning                                                                                              | Depends on | Failing means                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `GET /health` | Liveness: the process is up. Returns `status`, `sha` (deployed commit), `uptimeSeconds`.             | Nothing    | Restart the container. Render uses this as its health check.                                     |
| `GET /ready`  | Readiness: Postgres answers `SELECT 1` within 2 s. Returns 503 `{"status":"unavailable"}` otherwise. | Postgres   | Do not send traffic. The cause is in the logs (`readiness check failed`), never in the response. |

To check what is live: `curl https://<service>.onrender.com/health` and compare `sha` with the commit on `main`. `sha` comes from `GIT_SHA`, else Render's `RENDER_GIT_COMMIT`, else `unknown`.

## Free-tier behaviour

- The API sleeps after about 15 minutes idle (not while the uptime monitor runs, see "Running unattended until results"); the first request wakes it (tens of seconds). Hit `/health` a minute before a demo.
- Neon also sleeps; the first `/ready` after idle can take a few seconds.

## Secrets: where each lives

| Secret                          | Set in                                  | Used by        |
| ------------------------------- | --------------------------------------- | -------------- |
| `DATABASE_URL` (Neon pooled)    | Render service env                      | API at runtime |
| `NEON_DIRECT_URL` (Neon direct) | GitHub `production` environment secrets | CD migrations  |
| `RENDER_DEPLOY_HOOK_URL`        | GitHub `production` environment secrets | CD deploy step |

Nothing secret is committed; `.env.example` lists names only.

## Database connections dropping

Neon free suspends compute after about 5 minutes idle and drops connections with code 57P01 ("terminating connection due to administrator command"); the pool error handler logs a warning (`idle database client error`) and the next query reconnects. Seeing that warning after a quiet period is normal; a crash is not.

## Send a test question to a shop

For trying the shop app (`/app/shop`) by hand. Use a different phone number for the customer than for the shop. Both must be in the server's `DEMO_PHONES` (see below), or the inbox will not show their code; set the customer's as `DEMO_CUSTOMER_PHONE` in your shell first. The shop must be a grocery shop within 2 km of the point below (the default radius), and the customer asks for an item it does not already know the shop has (the 30 minute per-shop, per-item dedupe skips a shop it asked recently: pick another item, such as `chini`, `namak`, `doodh`).

```sh
B=https://kahanmilega-api.onrender.com
J='content-type: application/json'
login() { # phone role -> token
  curl -s -X POST $B/auth/otp/request -H "$J" -d "{\"phone\":\"$1\"}" >/dev/null
  CODE=$(curl -s "$B/dev/otp-inbox?phone=$1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')
  curl -s -X POST $B/auth/otp/verify -H "$J" -d "{\"phone\":\"$1\",\"code\":\"$CODE\",\"role\":\"$2\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])'
}
CUSTOMER=$(login "$DEMO_CUSTOMER_PHONE" seeker)

# aata, with a price the customer has seen elsewhere (Rs 60). Look at the shop app within a few seconds.
curl -s -X POST $B/requests -H "authorization: Bearer $CUSTOMER" -H "$J" \
  -d '{"q":"aata","lat":22.7196,"lng":75.8577,"targetPricePaise":6000}'
```

Then answer on the phone and read the result as the customer: `curl -s $B/requests/<id> -H "authorization: Bearer $CUSTOMER"`.

## Scripted fake model

`LLM_PROVIDER=fake FAKE_LLM_SCENARIO=<file>` makes the errand agent play a fixed script instead of calling a model; the browser test uses it so a whole errand is the same every time. The file is JSON, `{"turns": [{"toolCalls": [{"name", "args"}], "text"?}]}`. Turn _n_ is played when the conversation already holds _n_ model messages, so the script survives waiting for shops, the customer's answer and an API restart. An argument that is exactly `$item:<words>` becomes the id `resolve_item` returned for those words earlier in the conversation, so a script never needs database ids. `e2e/errand-scenario.json` asks one multi-select question ("Ye cheezein chahiye?"), resolves chai patti, adrak and doodh, asks the shops and submits. It only drives the errand agent: item resolution and search still use the normal free steps (synonyms, trigram), so use words that are in the catalog. Never set it in production.

## Run the simulator against the live site

The simulator makes fake shops around a point and answers real pings, so a seeker sees live answers without real shopkeepers. It needs the server's admin token, `ADMIN_TOKEN` (ADR-0058). It is a secret, not a phone: nobody can log in as admin, and no OTP flow reaches it.

**One-time setup on Render.** Make a token with `openssl rand -hex 32`. Dashboard → `kahanmilega-api` → Environment → add `ADMIN_TOKEN` with that value (at least 32 characters) → Save. Render redeploys. Without it the admin endpoints answer 404 to everyone, and the server refuses a shorter one at startup. Keep the value in your password manager and export it in the shell that runs the simulator; never put it in a file in the repo or on a command line. To rotate it, change it on Render and in your shell.

The demo login uses the same idea in reverse: set `DEMO_PHONES` on Render (comma-separated, 10-digit throwaway numbers that no real shop, customer or admin uses; anyone can read their codes). Only those numbers get a code in the demo inbox; anyone else can ask for a code but cannot read it. Production does not start with it empty. After a deploy, `scripts/verify-live-security.sh` checks the live site (about once per 10 minutes, it uses this machine's sign-in budget; `--ipv4`, `--ipv6` or `--both` test one address family at a time; if its limit checks split, set `LIMITER_DIAG=on` on Render for one run and read the `limiter key` log lines, hashes only, then turn it off: ADR-0058). `PUBLIC_DEMO_SHOP_PHONES` and `PUBLIC_DEMO_CUSTOMER_PHONES` (subsets of `DEMO_PHONES`) are the numbers the two login screens offer as tap-to-fill chips; anything not also in `DEMO_PHONES` is dropped at startup with a warning (ADR-0066). Other variables you may meet: `OTP_INBOX_OPEN` is for tests and production refuses it; `ADMIN_PHONES` no longer exists and production refuses it too; `TRUST_PROXY_HOPS` is 1 for Render.

**Start it** (wake the free instance first; it sleeps after 15 minutes idle):

```sh
B=https://kahanmilega-api.onrender.com
curl -s $B/health
read -rs ADMIN_TOKEN && export ADMIN_TOKEN   # paste the token; it is not shown or saved
npm run simulate -- --target $B --count 200 --speed 10 --centre 22.7196,75.8577
```

Delivery orders (ADR-0032): the simulator also answers an order placed with one of its shops, over the same admin stream (`order.created`): about one in five is declined, the rest are accepted after 3-30 s, set out 5-30 s later and delivered 10-60 s after that (all divided by `--speed`). Orders expire after 10 minutes without an answer; `SELECT state, expires_at FROM delivery_orders ORDER BY created_at DESC LIMIT 5` shows them. The address lives only in that table, plus `saved_addresses` for a customer who ticked "Is pate ko yaad rakhein" (ADR-0033). An hourly sweep clears `address_text`, `lat` and `lng` 30 days after an order ended: `SELECT count(*) FROM delivery_orders WHERE address_text IS NOT NULL AND state IN ('DELIVERED','DECLINED','EXPIRED','CANCELLED') AND updated_at < now() - interval '30 days'` should be 0 an hour after the workers start.

`--speed 10` makes replies ten times faster (5-90 s becomes 0.5-9 s); use `--speed 1` for realistic timing. It prints one line per answer and keeps running until Ctrl+C. The first run creates the shops and saves their tokens in `apps/simulator/.sim-state.json`; later runs with the same options reuse them. Starting without a matching state file first deletes all simulated shops on the server, then makes new ones. `--reset` forces that.

**Ask for something and watch it get answered** (second terminal; use another phone for the customer, and an item you have not asked about in the last 30 minutes: `aata`, `chini`, `namak`, `doodh`):

```sh
B=https://kahanmilega-api.onrender.com
J='content-type: application/json'
login() { # phone role -> token
  curl -s -X POST $B/auth/otp/request -H "$J" -d "{\"phone\":\"$1\"}" >/dev/null
  CODE=$(curl -s "$B/dev/otp-inbox?phone=$1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')
  curl -s -X POST $B/auth/otp/verify -H "$J" -d "{\"phone\":\"$1\",\"code\":\"$CODE\",\"role\":\"$2\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])'
}
CUSTOMER=$(login "$DEMO_CUSTOMER_PHONE" seeker)

# Open the live stream first (a one-time ticket in the URL, never the token), then ask.
TICKET=$(curl -s -X POST $B/events/ticket -H "authorization: Bearer $CUSTOMER" | python3 -c 'import sys,json;print(json.load(sys.stdin)["ticket"])')
curl -sN "$B/events?ticket=$TICKET" &

ID=$(curl -s -X POST $B/requests -H "authorization: Bearer $CUSTOMER" -H "$J" \
  -d '{"q":"chini","lat":22.7196,"lng":75.8577}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Each "request.updated" line is a hint; read the request to see the answers.
watch -n 2 "curl -s $B/requests/$ID -H 'authorization: Bearer $CUSTOMER' | python3 -m json.tool | grep -E 'state|name|pricePaise|source'"
```

**Clean up.** Ctrl+C stops the simulator. The fake shops stay on the server (they also teach learned stock). To remove them, call `DELETE $B/admin/sim/shops` with `authorization: Bearer $ADMIN_TOKEN`, or start the simulator with a different `--seed` and `--reset`, then stop it.

**If it does not start.** `did not accept ADMIN_TOKEN` means the value differs from Render's or Render has not redeployed yet. A refused stream with HTTP 503 means the API has no `REDIS_URL`.

## Demo mode without the laptop (ADR-0062)

The API can answer for the simulated shops itself, so the live site works with the laptop off.

**One-time setup on Render.** Environment → add `DEMO_AUTOPILOT` = `on` (and optionally `DEMO_AUTOPILOT_MAX_PER_MINUTE`, default 30) → Save. Add the demo numbers you want to log in with to `DEMO_PHONES` (9000000102 to 106 for the shops, 9000000202 to 206 for the customers). Set it to `off` (or delete it) and restart to stop it completely: no queue, no listener, no code change. It only ever answers shops marked simulated.

**Before a demo** (wakes the instance, clears what the last rehearsal left, makes the shops):

```sh
read -rs ADMIN_TOKEN && export ADMIN_TOKEN   # paste the token; it is not shown or saved
bash scripts/demo.sh reset && bash scripts/demo.sh seed
```

Both print counts only. `reset` removes requests, lists, errands, orders and pings that involve a demo number (9000000101 to 110, 201 to 210), clears what the demo shops learned and seeds again; nothing else is touched. `seed` is safe to repeat. The stock prices are invented (see `apps/api/src/modules/demo/fixtures.ts`).

**Check it is on.** The log has `demo autopilot is on` at startup, and `demo shop answered a ping` lines (with the request id) as searches arrive. An answer comes 5 to 90 s after the ping. The laptop simulator still works for local runs; do not run both against the same site.

## Run the end-to-end browser test

One real browser test (Playwright, Chromium at 360 px) of the customer app against the whole stack: it logs in with Demo mode (a new random phone each time; the test server sets `OTP_INBOX_OPEN`, never production), taps "Demo location", searches `chini` with a price of ₹60, and expects a map pin, a list row with a price and a "haan" in the status line within 30 seconds. Five simulated grocery shops answer in the background. It is not part of `npm run test:unit` or `test:integration`; CI runs it as the `e2e` job.

```sh
npm install
cp .env.example .env        # once
npm run db:up               # Postgres and Redis
npm run db:migrate
npm run seed:catalog
npx playwright install chromium   # once per Playwright version
npm run test:e2e            # builds the apps, starts the API on port 3100, runs the test
```

The screenshot is saved to `e2e/artifacts/seeker-results.png` (in CI it is the `e2e` artifact of the run). The test starts its own API on port 3100 with a throwaway admin token made for each run, and deletes and recreates all simulated shops in the database it uses, so use a local database, never the live one. The map tiles come from OpenStreetMap; if they cannot load the test still passes, because it checks pins and the list.

## Running unattended until results (Nov 6)

ADR-0064. Nobody is watching; the API must stay up by itself.

**Uptime monitor.** UptimeRobot, `GET https://kahanmilega-api.onrender.com/health`, every 10 minutes, email alerts. `/health` answers 84 bytes and touches neither Postgres nor Redis, so it wakes the instance without keeping Neon awake on its own (`/ready` runs `SELECT 1`). Render's 15-minute sleep never starts, so the API, the workers and the 60 s sweeper run 24/7. What can run out before results, and what to do, is in [limits.md](limits.md).

**What runs by itself.** One free Render web service; the workers run inside the API process. Redis is Render Key Value, free, 25 MB, `noeviction`.

| What                                                                                                          | How often                                    |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Expiry sweep (also re-queues lost ping fan-outs, and runs the order, list, errand and pickup-reminder sweeps) | every 60 s                                   |
| Photo sweep                                                                                                   | every 10 min                                 |
| Address sweep and pickup sweep                                                                                | every 60 min                                 |
| BullMQ workers (fan-out, push, errand, expiry): idle polling of Redis                                         | continuous, in Redis                         |
| Demo autopilot                                                                                                | on events; catch-up once at start            |
| Old completed jobs clean-up (logs `removed old completed jobs`)                                               | once at start                                |
| SSE heartbeat                                                                                                 | every 20 s per open stream                   |
| GitHub crons                                                                                                  | none (the evals cron is paused until Oct 30) |
| CI                                                                                                            | only on a PR or a push                       |
| Laptop: the runner service and the runner watchdog timer                                                      | watchdog every 5 min                         |

Probes: `/health` and `/` touch neither Postgres nor Redis; `/ready` runs `SELECT 1`. The sweeper alone is about 10 queries a minute, so Neon does not suspend while the API is awake.

**Free-tier budget.** Neon: 100 CU-hours a month; 14.25 used by Oct 24, about 62 projected for October, about 36 for Nov 1 to 6. Render: one free web service, about 744 of 750 h. Redis: Render Key Value free, 25 MB, `noeviction`.

**Weekly check** (and before results; full numbers and fixes in [limits.md](limits.md)):

1. Neon, Billing, Usage: if above 80 CU-hours, pause the monitor (the API then sleeps and wakes on demand, about 14 s).
2. Render, Usage: instance hours, outbound bandwidth (5 GB; over it every free service is suspended) and pipeline minutes.
3. AI Studio, rate limits, for **both** projects: "Gemini Project" (production) and "Gemini Project 2" (evals). Production `embedding-1` above 700 of 1,000 requests a day, or either flash-lite model above 350 of 500, means stop bulk work and read limits.md.
4. Redis: `ADMIN_TOKEN` in the shell, then `scripts/release-check.sh`. The "Redis memory" line warns above 40 % of `maxmemory` and fails above 60 %. The same two numbers are in `/admin/health/details` under `redis.memory` (`"unknown"` if Redis refuses `INFO`; the check then warns). A rising line means a queue is keeping jobs: look at `removed old completed jobs` in the logs and the queue counts.
5. Models: `ADMIN_TOKEN` in the shell, then `curl -s $B/admin/ai/ping -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{ok, results: [.results[] | {purpose, role, model, ok, kind, status}]}'`. It makes about 5 tiny calls (one per model and purpose, plus one embedding; no breaker, nothing stored), so run it once a week, not in a loop. Every row `ok: true` means each model we name still answers. `status: 404` means the model was retired or renamed (Google keeps retired models in its list but answers "no longer available to new users"): change the env var from `npm run ai:models` and see the failure-modes page. `status: 429` is a quota; the ping does not say which one, so read AI Studio.

**After the freeze:** `systemctl --user disable --now askbuy-runner-watchdog.timer`.

**Hotfix with the laptop off:** deleting the `RUNNER` repository variable would send CI to GitHub-hosted runners, but **that fallback is unavailable until Nov 1**: the hosted minutes are used up and the $0 budget blocks hosted jobs. Until then, turn the laptop on.

**After Nov 6:** delete the UptimeRobot monitor.

## Self-hosted runner (CI on the laptop)

The `ci`, `e2e`, `evals` and `agent-evals` jobs run on `runs-on: ${{ vars.RUNNER || 'ubuntu-latest' }}`; `deploy` too (it was the one job left on `ubuntu-latest`, so it never started when hosted minutes ran out; `evals/runners.test.ts` now fails if any job names a hosted runner). The deploy job needs only node, npm and curl (no psql, no docker); it takes `NEON_DIRECT_URL` and `RENDER_DEPLOY_HOOK_URL` from the `production` environment, not from a `.env`, and its own concurrency group `deploy-production` never cancels a running deploy. One runner runs one job at a time, so deploy cannot overlap e2e on the laptop. Each job writes its runner name to the run summary.

One-time prep, on the laptop:

1. Playwright's system libraries (needs sudo, which is why CI does not do it): `sudo env "PATH=$PATH" npx playwright install-deps chromium`.
2. The runner's user is in the `docker` group (`sudo usermod -aG docker $USER`, then log in again). Integration tests (Testcontainers) and the e2e job (`docker compose`) need it. No CI step uses sudo.
3. Install the runner as a service from `~/actions-runner`: `sudo ./svc.sh install && sudo ./svc.sh start`.
4. In the repo (Settings, Secrets and variables, Actions, Variables) set `RUNNER` to `self-hosted`.

Things to know:

- The laptop must be on and online during CI. A job waits for a runner and fails after the queue limit if it is off.
- CI never meets your local dev: the e2e job uses its own compose project (`askbuy-ci`, torn down at the end) and its own ports (Postgres 55432, Redis 56379, app 53100), all set in the workflow, never in `.env`. Keep `npm run db:up` running if you like.
- No cache uploads on the laptop: the npm cache (~/.npm is about 12 GB here, 2.9 GB compressed) is skipped on self-hosted, since the disk keeps it. The eval catalog embeddings live in `~/.cache/kahanmilega-evals` there.
- Back to GitHub's runners: delete the `RUNNER` variable. **Not possible until Nov 1** (hosted minutes exhausted, $0 budget); jobs would not start.

## Runner watchdog

Oct 23: the runner showed "online, idle" but took no job for about 2 h until restarted. `scripts/ops/runner-watchdog.sh` (user timer, every 5 min) restarts the runner service when a run has been queued over 10 min AND GitHub reports the runner online and not busy; at most once per 30 min. It does nothing when the runner is busy, offline, or nothing waits. Every action is in `~/kahan-tools/watchdog.log`. No token is used: `gh` uses its own login, and the only sudo rule is the one exact restart command.

Install (by hand, from the repo root; nothing here prints a token):

```sh
# 1. Allow only the runner restart without a password (check the syntax first).
sudo visudo -cf ops/sudoers/askbuy-runner-watchdog
sudo install -m 0440 -o root -g root ops/sudoers/askbuy-runner-watchdog /etc/sudoers.d/askbuy-runner-watchdog
sudo -n -l /usr/bin/systemctl restart actions.runner.PrakharDabkara-55_hackathon_prakhar.fiftyfive-ThinkPad-L14-Gen-5.service   # expect: the command path printed, no password prompt
# 2. Install and start the user timer.
mkdir -p ~/.config/systemd/user ~/kahan-tools
cp ops/systemd/askbuy-runner-watchdog.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now askbuy-runner-watchdog.timer
# 3. Check it.
systemctl --user list-timers askbuy-runner-watchdog.timer
gh auth status    # must be logged in as the same user the timer runs as
systemctl --user start askbuy-runner-watchdog.service && tail ~/kahan-tools/watchdog.log
```

The sudo rule can be used by anything that runs as your user, including workflow steps on the self-hosted runner; the worst it allows is restarting the runner service (accepted).

A quiet run writes nothing (the log only has actions). If `gh` fails under the timer, the log says "gh ... failed; nothing done". Remove: `systemctl --user disable --now askbuy-runner-watchdog.timer` and `sudo rm /etc/sudoers.d/askbuy-runner-watchdog`. The service name in the sudoers file is the one under `~/actions-runner/.service`; if the runner is ever re-registered, change it there and in `RUNNER_SERVICE`.

## AI configuration (query understanding)

Item matching tries a dictionary, trigram similarity, embeddings and then an LLM (ADR-0021). The model is Google's Gemini free tier behind a provider port (ADR-0020).

**Free-tier privacy rule.** Google may review free-tier prompts. The code sends only the customer's query text (cut to 100 characters) and catalog item names. Never add phone numbers (users or shops), user or owner ids, or locations to a prompt. A guard in the Gemini adapter blocks any prompt with a phone, email, coordinates or a contact/address key and logs only the reason (ADR-0060); shop names reach the errand agent as `<<<SHOP ... SHOP>>>` data. Item resolution sends no prices or shop data; the errand agent (ADR-0024) also sends public shop data from its tools (shop id, name, distance, price, freshness) and never shop or user coordinates. `ai_calls` stores tokens, latency and outcome, never prompt text.

| Variable                                              | Where                                                                     | Meaning                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LLM_PROVIDER`                                        | Render env, `.env`                                                        | `gemini` or `fake`. **Required in production**: the API refuses to start without it. `fake` (the local default) never calls the network.                                                               |
| `GEMINI_API_KEY`                                      | Render env (secret), GitHub `production` environment secret, local `.env` | Required when the provider is `gemini`. Never commit it.                                                                                                                                               |
| `GEMINI_MODEL`, `GEMINI_EMBED_MODEL`                  | Render env, `.env`                                                        | Defaults `gemini-3.1-flash-lite` and `gemini-embedding-001`.                                                                                                                                           |
| `GEMINI_FALLBACK_MODEL`                               | Render env, `.env`                                                        | Second model for the attempts after a timeout, 429 or 503 from the primary. Blank: none. Live: `gemini-3.5-flash-lite`.                                                                                |
| `GEMINI_ERRAND_MODEL`, `GEMINI_ERRAND_FALLBACK_MODEL` | Render env, `.env`                                                        | Models for the **errand agent only**. Unset or blank: it uses `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL`. Query resolution never reads them (its holdout gate was proven on `GEMINI_MODEL`). ADR-0027. |
| `ERRAND_AI_TIMEOUT_MS`                                | Render env, `.env`                                                        | Time limit of one errand model call. Default 30000. Resolve calls keep 8 s.                                                                                                                            |
| `EMBED_THRESHOLD`, `EMBED_MARGIN`                     | Render env, `.env`                                                        | Defaults 0.70 and 0.04. Re-tune with `npm run eval:resolve` after any model change.                                                                                                                    |

Commands (they read the key from your `.env` or the environment; none prints it):

```sh
npm run ai:models             # lists the models your key can use; pick names from here
LLM_PROVIDER=gemini npm run ai:embed-catalog   # embeds items whose text changed (about 2 minutes the first time)
LLM_PROVIDER=gemini npm run eval:resolve       # dev (81) and holdout (62) queries through the whole pipeline, see docs/evals.md
```

`EVAL_SET=dev|holdout-v2|holdout|list-dev|all`, `EVAL_KINDS=variant,ambiguous`, `EVAL_AI_PAUSE_MS` (default 5000) and `EVAL_DB=testcontainers` are described in `docs/evals.md`. Reports go to `evals/reports/` (git-ignored except `sample.json`). `eval:resolve` clears `query_cache` and `ai_calls`, so run it against a local database, or with `EVAL_DB=testcontainers`.

**Watching it.** `GET /admin/ai/stats` (admin token): answers by step, LLM fallback and cache-hit rates, average tokens per LLM call, p95 latency, errors, invalid outputs and breaker skips, for 24 hours and 7 days. The breaker opens after 5 failed calls in a row and AI is skipped for 60 seconds; searches keep working from the dictionary. A 429 in the logs (`AI call failed`, `status: 429`) means a free-tier rate limit.

**Cached answers.** They expire (30 days; 1 day for "nothing fits") and carry the catalog version, so a changed `catalog.seed.json` retires all of them by itself. To forget one wrong answer: `curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/ai/cache?q=xyzzy%20plugh"`.

**After a big catalog change:** run `npm run seed:catalog`, then `npm run ai:embed-catalog`. Review `suggested_synonyms` (`SELECT term, i.slug FROM suggested_synonyms s JOIN items i ON i.id = s.item_id`) and add good pairs to `catalog.seed.json` by hand.

## AI unavailable: troubleshooting

An errand ends `FAILED` with `ai_unavailable`, or a search stops using the LLM step. **The Gemini free tier answers 503 "high demand" often (about half of calls in some hours) and 429 when a per-minute quota is used up; a 503 can take 10 s to arrive.** This is normal for the free tier, not a bug; retries and the fallback model absorb most of it. In this order:

1. **Ask the API.** `curl -s $B/admin/ai/ping -H "Authorization: Bearer $ADMIN_TOKEN" | jq` (one tiny call per kind and model, no breaker, nothing stored). `ok: true` on the primary means the model is fine now. `kind`/`status` tell you more: `http 503` busy, `http 429` quota, `http 404` wrong model name (`npm run ai:models`), `http 400/403` bad request or key, `timeout` slower than the limit, `network` cannot reach Google, `other` unexpected.
2. **Read the logs** (Render, Logs): search `AI call failed`. Each line has `purpose` (errand, resolve_query, embed_query), `model`, `attempt` (0 is the first try), `kind`, `status`, `code` (Google's word, such as `UNAVAILABLE` or `RESOURCE_EXHAUSTED`), `latencyMs` and a short `message`. `AI call answered by the fallback model` means the primary failed and the fallback worked. `AI call skipped` with `kind: breaker` means five failures in a row: that purpose is paused for 60 s. The same kinds are in SQL: `SELECT purpose, model, outcome, count(*) FROM ai_calls WHERE created_at > now() - interval '1 hour' GROUP BY 1, 2, 3`.
3. **Check the quota page** in Google AI Studio (aistudio.google.com, your project, Usage or Rate limit): requests per minute and per day for the primary and the fallback model. `429`/`RESOURCE_EXHAUSTED` with a used-up quota there means wait for the reset or lower the traffic; errands run one at a time and pace Gemini calls 4 s apart.
4. **Still failing?** Raise `ERRAND_AI_TIMEOUT_MS` only if the log shows `kind: timeout` with `latencyMs` near the limit. Try another `GEMINI_FALLBACK_MODEL` from `npm run ai:models` if the fallback itself fails in the ping. A model that thinks (such as `gemini-3.5-flash`) needs `maxOutputTokens` of a few hundred or it ends with no answer, and some models (`gemini-3.5-flash`, `gemini-3.6-flash`) have tiny free quotas and answer 429 at once.

## Errands (the AI agent)

An errand is a task the agent plans from learned stock (ADR-0024). `POST /errands` stores it and queues a BullMQ job on the `errand` queue (concurrency 1, job id `errand-<id>`); the API process runs the worker when `WORKERS_ENABLED` and `LLM_PROVIDER` are set.

```sh
B=https://kahanmilega-api.onrender.com
TOKEN=...   # a seeker token, see "Send a test question to a shop"
ID=$(curl -s -X POST $B/errands -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"task":"chai banane ka saaman: chai patti, chini, doodh","lat":22.7196,"lng":75.8577}' | jq -r .id)
# Poll until it leaves PLANNING, then read the plan:
until [ "$(curl -s $B/errands/$ID -H "Authorization: Bearer $TOKEN" | jq -r .state)" != PLANNING ]; do sleep 3; done
curl -s $B/errands/$ID -H "Authorization: Bearer $TOKEN" | jq '{state, progress, plan, failureReason, usage}'
```

**Watching one.** `GET /errands/:id` shows `progress` (what it has done so far), `usage` (steps, tokens) and, when it ends, the plan or `failureReason`. The full step log is the table `errand_steps` (`SELECT n, kind, tool_name, args, result_summary, tokens, latency_ms FROM errand_steps WHERE errand_id = '<id>' ORDER BY n`). Logs are JSON with `errandId` and the `requestId` of the `POST` on every line (`errand model step`, `errand plan ready`, `errand failed` with the reason); model calls are rows in `ai_calls` with `purpose = 'errand'`, joined to the errand by that request id. Locally: `LLM_PROVIDER=gemini npm run errand:smoke "your task"` plans real errands against the local database (it adds a few `Smoke ...` demo shops with stock) and prints each step log with tokens.

**Failure reasons.** `step_limit` and `token_budget`: the agent was told to submit and did not (raise `ERRAND_MAX_STEPS` or `ERRAND_TOKEN_BUDGET` only after reading its step log); `ai_unavailable`: the model kept answering 429 or 5xx after retries (the free tier has busy spells, try again) or the breaker is open; `queue_unavailable`: Redis was down when the errand was created; `internal_error`: see the `errand run crashed` log line. `wait_limit`: the agent was told to submit after the maximum wait and did not.

**Waiting, questions, stuck errands (Day 13).** States: `WAITING_FOR_SHOPS` (asked shops; wakes when every request has left PINGING, after `ERRAND_RESUME_AFTER_MS`, or by the sweeper), `NEEDS_INPUT` (asked the user; `GET /errands/:id` shows `question`; answer with `POST /errands/:id/answer {"optionIndex":0}` or `{"text":"..."}`), `EXPIRED` (15 min). **Stuck?** Look at `SELECT state, lease_until, wait_deadline, answer_deadline, expires_at, waited_ms, resume_reason FROM errands WHERE id = '<id>'`. The 60 s sweeper re-queues a PLANNING errand whose lease ran out, resumes a WAITING one past its deadline and a NEEDS_INPUT one past its answer deadline, and expires overdue ones, so after a Redis restart or a sleeping instance wait a minute before touching anything. To nudge by hand, queue the job again (`errand` queue, any new job id): a job for an errand that is not due does nothing, and the lease makes a double run impossible. **Cancel:** `curl -X POST $B/errands/$ID/cancel -H "Authorization: Bearer $TOKEN"` (owner only) stops it and closes its open requests; as an operator, `UPDATE errands SET state = 'CANCELLED' WHERE id = '<id>' AND state IN ('PLANNING','WAITING_FOR_SHOPS','NEEDS_INPUT')` ends it (open requests then expire by themselves within 15 min). Stats: `GET /admin/errands/stats?hours=24` (errands by state, average steps and tokens, average wait, p95 duration, confirmed vs likely). Live check with the simulator running: `bash ~/kahan-tools/errand_test.sh` (also `BASE=http://localhost:3000`).

**Limits** (env, defaults): `ERRAND_MAX_ASK_SHOPS` 6, `ERRAND_MAX_QUESTIONS` 2, `ERRAND_RESUME_AFTER_MS` 45000, `ERRAND_MAX_WAIT_MS` 300000, `ERRAND_ANSWER_TIMEOUT_MS` 600000, `ERRAND_EXPIRY_MS` 900000, `ERRAND_RESUME_DEBOUNCE_MS` 1000, `ERRAND_MAX_ITEMS` 10, `ERRAND_MAX_STEPS` 8, `ERRAND_TOKEN_BUDGET` 20000, `ERRAND_USER_HOURLY_LIMIT` 5, `ERRAND_TASK_MAX_CHARS` 500, `ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE` 3000 (the fewest-shops plan is recommended if it costs at most that much, or 10 %, more; ADR-0025). `GET /errands/:id` returns `plan.plans.sasta`, `plan.plans.kam_dukaan` and `plan.recommended`; `bash ~/kahan-tools/errand_test.sh` prints both side by side. A task that reads like an instruction to a model answers `422 task_rejected` and is not stored.

## Agent evals (errand agent)

**Switching the errand model.** The errand agent and query resolution used to share `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL`. Now the errand agent follows `GEMINI_ERRAND_MODEL` and `GEMINI_ERRAND_FALLBACK_MODEL` when they are set, and resolve keeps `GEMINI_MODEL`. To move errands to `gemini-3.5-flash-lite` with `gemini-3.1-flash-lite` as its fallback, set both in the Render dashboard (Environment) and redeploy; to go back, delete both. **To confirm which model errands really use:** `SELECT model, count(*) FROM ai_calls WHERE purpose = 'errand' AND created_at > now() - interval '1 hour' GROUP BY model;` (the `ai_calls.model` column records the model that answered each call; resolve rows have `purpose = 'resolve_query'`). The logs say the same: every failed attempt logs `purpose` and `model`, and `AI call answered by the fallback model` marks a switch. Note that `GET /admin/ai/ping` still tests the shared `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` only, so it does **not** show the errand model. The harness's `model=primary|fallback` input sets `GEMINI_ERRAND_MODEL`.

`npm run eval:errand` plays every case of `evals/errand.<set>.jsonl` as a real errand, in process, against the real model, a throwaway Postgres with the seeded catalog, eight synthetic shops and a deterministic shop responder (ADR-0027). It needs `LLM_PROVIDER=gemini` and `GEMINI_API_KEY` in the environment (locally: your own `.env`, from your local-dev project, never the eval project's key). It prints the estimated number of model calls first and refuses a run over 300 (the dev set is 26 cases and estimates 274; split it with `EVAL_CASES=d01,d02`). `EVAL_SET=dev|holdout`, `EVAL_MODEL=primary|fallback`, `EVAL_GATE=1` (gates apply to the holdout only), `EVAL_PACE_MS=4000`. It writes `evals/reports/errand-<set>-<model>-<time>.json` and a markdown summary.

In CI the `agent-evals` job runs when a PR carries the `agent-evals` label (dev set, on `GEMINI_MODEL`, which is no longer the errand model once `GEMINI_ERRAND_MODEL` is set) or by hand: Actions, Evals, Run workflow, `suite` = agent, `set` = dev or holdout, `model` = primary or fallback (the errand model: `primary` is `GEMINI_MODEL`, `fallback` is `gemini-3.5-flash-lite`). With errands on `gemini-3.5-flash-lite`, the run that matters is `set` = dev, `model` = fallback. It never runs on the schedule. It uses the `evals` environment and the same quota group as the resolve evals, so it queues behind them. **The holdout is run on request, once per change that justifies it, and is never used to tune a prompt or code**; a holdout failure that shows a real bug gets a similar new case in the dev file, and the fix is made against that. `QUOTA_EXHAUSTED` means the same as for the resolve evals (see below).

## GitHub: the `evals` environment

The `evals` workflow needs a GitHub environment named `evals` with a `GEMINI_API_KEY` secret (Settings, Environments, New environment, add the secret). It must be a key from a **separate Google project** than production's. Without it the job fails with "GEMINI_API_KEY missing". The `agent-evals` job (see "Agent evals") uses the same environment and key. The resolve job runs when a PR carries the `evals` label, by hand (Actions, Evals, Run workflow); the daily 08:30 UTC run on `main` is paused until Oct 30 (see "Evals: timeouts, quota, schedule paused until Oct 30"; never on push: a merge would spend the day's quota). Runs on one ref never overlap (a newer run cancels the older) and each job times out after 30 minutes. Every job in every workflow runs on `ubuntu-24.04`, pinned so GitHub's move of `ubuntu-latest` to Ubuntu 26 (2026-10-19) changes nothing; bump it on purpose.

**Three Google projects, three keys.** Never share one: a quota used in one place must not stop another.

| Project   | Key lives in                                        | Used by                                                            |
| --------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| Live      | Render env, GitHub `production` environment secret  | the running site and the deploy's catalog embedding                |
| CI evals  | GitHub `evals` environment secret                   | the `evals` workflow (scheduled, labelled PRs, manual runs)        |
| Local dev | your `.env` (git-ignored; never print or commit it) | `npm run eval:resolve`, `ai:embed-catalog`, `errand:smoke` locally |

**`QUOTA_EXHAUSTED — rerun after the daily reset`.** The eval run stopped on purpose, exit code 3, with this message in the step summary. It means the eval project's free Gemini quota is used up for today: either Google answered 429 `RESOURCE_EXHAUSTED` naming a per-day quota, or three 429s in a row asked for a wait of more than 60 s. (An ordinary per-minute 429 is retried as before.) A preflight call (one embedding, one tiny answer) runs before anything starts, so a spent quota fails in seconds, not after 45 minutes of retries. The code does not look broken; do not change it. Rerun after the daily reset, or let the 08:30 UTC schedule do it. The reset is at midnight Pacific time (07:00 or 08:00 UTC depending on the season), so 08:30 UTC is after it. The budget is one full run per day per project: a local `eval:resolve` with the same project's key spends the same quota the schedule needs, so use a separate local-dev project.

## Evals: timeouts, quota, schedule paused until Oct 30

Eval jobs once ran 20 to 78 minutes while a healthy run takes about 8, and one stuck job held the only self-hosted runner. Now:

- **Every model or embedding request has 30 s** (`withRequestTimeout`, applied to the Gemini provider everywhere, so also the preflight calls). A timeout is a failure like any other: it is retried and then tried on the fallback model. Production keeps its own, shorter limits (8 s resolve, `ERRAND_AI_TIMEOUT_MS` errands) on top.
- **At most 3 retries per call.** The pause doubles each time with jitter, never over 30 s; a 429 that says how long to wait (Retry-After) is obeyed, capped at 30 s. A per-day 429 is not retried at all.
- **A spent daily quota ends the run at once**: `QUOTA_EXHAUSTED` in the log and job summary, exit code 3 (see "QUOTA_EXHAUSTED" above). Rerun after the reset.
- **Progress**: one line every 10 cases, counts only: `progress dev: 20/143, passes 17, retries 2, elapsed 4:12`. For a holdout set the log shows these lines and the aggregate table, never a case id, input or expected value. (The JSON report in the uploaded artifact still lists the cases; do not share it.)
- **Both jobs time out after 30 minutes**, and a newer run on the same ref cancels the older one. The embeddings cache is written after every embedded batch and saved with `always()`, so a killed run keeps what it paid for.
- **The daily schedule is paused until Oct 30.** To restore it after Oct 30, add `schedule: - cron: '30 8 * * *'` back under `on:` in `.github/workflows/evals.yml` and flip the "no schedule" test in `evals/workflow.test.ts`. Until then the cache is seeded by the first run of each catalog version, and the 08:30 UTC mentions above and below apply only once it is back.
- **If a job still looks stuck**, cancel it in Actions; the next run picks up the saved embeddings.

## npm install scripts

npm 11 asks which dependency install scripts may run. The decision, kept in `allowScripts` in the root `package.json` (so `npm ci` prints no warning):

| Package            | Script                             | Decision | Why                                                                                       |
| ------------------ | ---------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `@google/genai`    | `preinstall: echo`                 | denied   | A no-op.                                                                                  |
| `cpu-features`     | `node-gyp rebuild`                 | denied   | Optional native speed-up for `ssh2`, which Testcontainers pulls in; pure JS is used.      |
| `ssh2`             | `install.js`                       | denied   | Builds an optional native crypto module; falls back to JS. Only tests use it.             |
| `msgpackr-extract` | `node-gyp-build-optional-packages` | denied   | Optional native speed-up for BullMQ's serialiser; the JS path is correct and fast enough. |
| `protobufjs`       | `postinstall`                      | denied   | Only checks versions for its CLI, which we do not use.                                    |

Nothing here is needed to build or run the app. Approve one (`npm install-scripts approve <package>`) only if a profile shows its native module matters.

**Evals and the free quota.** Evals use their own Google project and key (the `evals` environment secret and your local `.env`), never the key in Render or the `production` environment, so a run can never use up the live site's quota. Limits per project: embeddings 100 requests/min and 1,000/day (each text counts as one), Flash Lite 15/min and 500/day. The runner stays inside them: catalog embedding at 60 texts/min (20 per batch, 20 s apart), at most one model call every 5 s (about 12/min), 429s retried with doubling waits. One full run is about 224 + 143 embedding requests and about 60 generation requests, so **the budget is one full eval run per day per project**. The catalog vectors are cached in CI (`evals/.cache`, keyed on the hash of `catalog.seed.json`), so after the first run on a given catalog only changed items cost embedding requests; the log line `loaded N saved embeddings` shows a cache hit.

## Open catalog and a failed embedding step (Day 15)

- **Migrations run on deploy** (CD job, before the new code). Migration 014 only adds columns, a table and wider category checks, so the previous release keeps working against it. Nothing to set by hand.
- **The deploy's embedding step can fail without stopping the deploy.** Look in the job summary of the deploy run ("Catalog embeddings not finished: N items still un-embedded"). Search still works; only the closest-meaning step skips those items. The next deploy embeds exactly the missing ones. To do it sooner by hand: `LLM_PROVIDER=gemini npm run ai:embed-catalog` with your own key.
- **New items.** `SELECT slug, name_en, category, unverified, created_at FROM items WHERE source = 'user' ORDER BY created_at DESC` lists what customers added; `new_item_attempts` shows created and blocked attempts (the rule only, never the text). Logs: search `new_item_blocked` and `new_item_created`. To remove one: `DELETE FROM items WHERE id = ...` (its stock and synonyms go with it).
- **Blocked item that should be allowed:** add an `ALLOWED_PHRASES` entry and a test in `modules/safety/denyList.ts`. **Safety check down or AI failing** shows as `ai_busy` (503, "Our assistant is busy"); `/admin/ai/ping` shows each model by purpose.

## Photos (Day 15)

- **Setting:** `PHOTO_STORAGE_CAP_MB` (Render env, default 300). Uploads above it get 503 `photo_storage_full`; the app keeps working without photos. **Migration 015 runs on deploy** and only adds a table; nothing to set by hand.
- **How much is stored:** `SELECT count(*), pg_size_pretty(sum(size)) FROM photos`; every upload logs `photo_stored` with `totalBytes`, the sweeper logs `photos_swept`. To free space now: `DELETE FROM photos WHERE created_at < now() - interval '1 day'` (cards simply show no photo).
- **A photo that should not be there:** `DELETE FROM photos WHERE id = ...`. No photo is ever sent to Gemini or anywhere outside Postgres.

## Quantity, delivery and the open switch (Day 16)

- **Migration 016 runs on deploy** and only adds columns; nothing to set by hand.
- **A shop stuck closed:** `UPDATE shops SET closed_until = NULL WHERE id = ...`. Closing lasts until the end of the day in India by itself.
- **What a shop offered:** `SELECT qty_amount, qty_unit, delivers, delivery_fee_paise, delivery_minutes FROM pings WHERE id = ...` (and the same columns on `shop_stock`). Orders and addresses come with the next PR.

## Web Push notifications (Day 16, PR F)

Off until you give it keys. Nothing breaks without them: the API logs one warning at startup (`web push is off`) and the notification button is hidden.

**Turn it on (Render)**

1. In your own terminal run `npm run push:keys`. It prints a public key, a private key and the three names to set. Keep the output to yourself.
2. In Render, service → Environment, add: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (a secret), `VAPID_SUBJECT` (`mailto:` plus an email you read). Save; Render redeploys. For local trials put the same three in your `.env`. Optional: `PUSH_MAX_PER_MINUTE` (default 5).
3. Migration 019 runs on deploy. Redis and `WORKERS_ENABLED=true` must already be on; push shares the queue's Redis.
4. Check: `GET /push/config` answers `{"enabled":true,"publicKey":"..."}`; the logs no longer show `web push is off`.

**Try it live**

- _Desktop Chrome:_ open the site, log in as a shop, tap "Notification chalu karein", allow. From another browser or window ask for an item the shop sells; a "Naya sawaal: ..." notification appears even with the tab in the background; clicking it focuses the app.
- _Android Chrome:_ same, on the phone. Add the site to the Home Screen first if you want the icon; it is not required on Android.
- _iPhone:_ push works only from the Home Screen app (iOS 16.4 or later): Share → Add to Home Screen, open it from there, then tap the button.

**When it does not work**

- `push queued` in the logs but nothing on the phone: look for `push job failed` with a status. 401 or 403 means the keys on Render do not match the key the browser subscribed with; tap "Notification band karein" then "chalu karein" again.
- `push subscription gone, removed`: the browser unsubscribed; normal.
- Nothing queued: the shop is simulated (never pushed), has no subscription, or hit the per-minute limit (`push dropped`).
- Replacing the public key cancels every subscription; everyone taps the button once more.
- Inspect: `SELECT user_id, created_at, last_success_at FROM push_subscriptions;` (never select `endpoint` or the keys into a chat or ticket).

## "Le liya?" and "Aaj ki maang" (Day 16, PR G)

Nothing to set up. Migration 020 runs on deploy and only adds.

- `PICKUP_ASK_AFTER_MINUTES` (default 15): how long after a tap on "Raasta" the home screen asks. The reminder push an hour after the tap needs push keys (see above); without them only the home screen asks.
- A shop says customers did not find its item: nothing to do, that is the point. To look, `SELECT shop_id, item_id, wrong_reports, customer_verified_at FROM shop_stock WHERE wrong_reports > 0;`. A shop's next real yes clears nothing in the counter, but "Mil gaya" lowers it by one.
- Visits (`pickup_visits`) hold a customer, a shop and an item for 30 days, then an hourly sweep deletes them. Do not export them.

## "Kya aapka matlab…?" and the follow-ups (Day 17, PR H)

Nothing to set up. Migration 021 runs on deploy and only adds; run `npm run seed:catalog` so catalog version 6 (the `ambiguous` words) is in the database.

- **How often are we asked wrong?** Count the log events `understanding_shown`, `understanding_confirmed` and `understanding_changed` (each carries the request id; `understanding_shown` has `kind`: `confirm` or `ambiguous`). A high changed share for `confirm` means the guesses are poor; look at the queries in `search_queries` with `matched_by` other than `synonym`.
- **A word that should ask which one:** add it to `ambiguous` in `catalog.seed.json` (the word must not already be a name, synonym or default), bump the version, seed. **A word that should never match an item through half a term:** nothing to list; it follows from the terms ("jhadu" is a term of the broom, so "phool" is not).
- **A shop was not asked again after "Wahan nahi tha":** `SELECT shop_id, invalidated_at, last_confirmed_at FROM shop_stock WHERE invalidated_at IS NOT NULL;`. It is asked on the next search until it has been pinged once after `invalidated_at`.
- The labels: this PR changes resolve and the errand agent, so it needs `evals` and `agent-evals`.

## Catch-up pings (Day 17, PR I, ADR-0038)

Nothing to set up; it runs on the ping fan-out queue (so it needs Redis, like the fan-out). A shop that opens late is asked once about requests it missed. To check: `SELECT p.request_id, p.sent_at FROM pings p WHERE p.shop_id = '<shop>' ORDER BY sent_at DESC;` and the log line `catch-up pings sent to a shop that opened`. No line and no pings: the shop was still closed, the requests were over, answered or inside 2 minutes of ending, or in another category. The expected behaviour of the other interactions is in `docs/scenarios.md`.
