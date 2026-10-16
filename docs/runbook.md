# Runbook (v5)

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
- Every request line has `req.id`, which is the `x-request-id` the caller sent or one we generated, and is echoed in the response header. Search the id in the Logs filter to follow one request.
- Locally: `docker logs <container>` or the terminal running `npm run dev -w @kahanmilega/api`.

## What the probes mean

| Endpoint      | Meaning                                                                                              | Depends on | Failing means                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `GET /health` | Liveness: the process is up. Returns `status`, `sha` (deployed commit), `uptimeSeconds`.             | Nothing    | Restart the container. Render uses this as its health check.                                     |
| `GET /ready`  | Readiness: Postgres answers `SELECT 1` within 2 s. Returns 503 `{"status":"unavailable"}` otherwise. | Postgres   | Do not send traffic. The cause is in the logs (`readiness check failed`), never in the response. |

To check what is live: `curl https://<service>.onrender.com/health` and compare `sha` with the commit on `main`. `sha` comes from `GIT_SHA`, else Render's `RENDER_GIT_COMMIT`, else `unknown`.

## Free-tier behaviour

- The API sleeps after about 15 minutes idle; the first request wakes it (tens of seconds). Hit `/health` a minute before a demo.
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

For trying the shop app (`/app/shop`) by hand. Use a different phone number for the customer than for the shop. The shop must be a grocery shop within 2 km of the point below (the default radius), and the customer asks for an item it does not already know the shop has (the 30 minute per-shop, per-item dedupe skips a shop it asked recently: pick another item, such as `chini`, `namak`, `doodh`).

```sh
B=https://kahanmilega-api.onrender.com
J='content-type: application/json'
login() { # phone role -> token
  curl -s -X POST $B/auth/otp/request -H "$J" -d "{\"phone\":\"$1\"}" >/dev/null
  CODE=$(curl -s "$B/dev/otp-inbox?phone=$1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')
  curl -s -X POST $B/auth/otp/verify -H "$J" -d "{\"phone\":\"$1\",\"code\":\"$CODE\",\"role\":\"$2\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])'
}
CUSTOMER=$(login 9876500011 seeker)

# aata, with a price the customer has seen elsewhere (Rs 60). Look at the shop app within a few seconds.
curl -s -X POST $B/requests -H "authorization: Bearer $CUSTOMER" -H "$J" \
  -d '{"q":"aata","lat":22.7196,"lng":75.8577,"targetPricePaise":6000}'
```

Then answer on the phone and read the result as the customer: `curl -s $B/requests/<id> -H "authorization: Bearer $CUSTOMER"`.

## Run the simulator against the live site

The simulator makes fake shops around a point and answers real pings, so a seeker sees live answers without real shopkeepers. It needs an admin: a phone listed in `ADMIN_PHONES`.

**One-time setup on Render.** Dashboard → `kahanmilega-api` → Environment → Add Environment Variable → key `ADMIN_PHONES`, value a 10-digit mobile number that no real shop or customer uses (for example `9876500099`; several numbers are comma-separated) → Save. Render redeploys. Without it the admin endpoints answer 404 to everyone. Logging in with that number gives it the admin role, so it cannot also be a shop or seeker account.

**Start it** (wake the free instance first; it sleeps after 15 minutes idle):

```sh
B=https://kahanmilega-api.onrender.com
curl -s $B/health
npm run simulate -- --target $B --admin-phone 9876500099 --count 200 --speed 10 --centre 22.7196,75.8577
```

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
CUSTOMER=$(login 9876500011 seeker)

# Open the live stream first (a one-time ticket in the URL, never the token), then ask.
TICKET=$(curl -s -X POST $B/events/ticket -H "authorization: Bearer $CUSTOMER" | python3 -c 'import sys,json;print(json.load(sys.stdin)["ticket"])')
curl -sN "$B/events?ticket=$TICKET" &

ID=$(curl -s -X POST $B/requests -H "authorization: Bearer $CUSTOMER" -H "$J" \
  -d '{"q":"chini","lat":22.7196,"lng":75.8577}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Each "request.updated" line is a hint; read the request to see the answers.
watch -n 2 "curl -s $B/requests/$ID -H 'authorization: Bearer $CUSTOMER' | python3 -m json.tool | grep -E 'state|name|pricePaise|source'"
```

**Clean up.** Ctrl+C stops the simulator. The fake shops stay on the server (they also teach learned stock). To remove them, sign in as the admin and call `DELETE $B/admin/sim/shops`, or start the simulator with a different `--seed` and `--reset`, then stop it.

**If it does not start.** `... is not an admin` means `ADMIN_PHONES` is not set or has not redeployed yet. `Too many OTP requests` means wait ten minutes. A refused stream with HTTP 503 means the API has no `REDIS_URL`.

## Run the end-to-end browser test

One real browser test (Playwright, Chromium at 360 px) of the customer app against the whole stack: it logs in with Demo mode, taps "Demo location", searches `chini` with a price of ₹60, and expects a map pin, a list row with a price and a "haan" in the status line within 30 seconds. Five simulated grocery shops answer in the background. It is not part of `npm run test:unit` or `test:integration`; CI runs it as the `e2e` job.

```sh
npm install
cp .env.example .env        # once
npm run db:up               # Postgres and Redis
npm run db:migrate
npm run seed:catalog
npx playwright install chromium   # once per Playwright version
npm run test:e2e            # builds the apps, starts the API on port 3100, runs the test
```

The screenshot is saved to `e2e/artifacts/seeker-results.png` (in CI it is the `e2e` artifact of the run). The test starts its own API on port 3100 with a throwaway admin phone (`9810000999`), and deletes and recreates all simulated shops in the database it uses, so use a local database, never the live one. The map tiles come from OpenStreetMap; if they cannot load the test still passes, because it checks pins and the list.

## AI configuration (query understanding)

Item matching tries a dictionary, trigram similarity, embeddings and then an LLM (ADR-0021). The model is Google's Gemini free tier behind a provider port (ADR-0020).

**Free-tier privacy rule.** Google may review free-tier prompts. The code sends only the customer's query text (cut to 100 characters) and catalog item names. Never add phone numbers, user ids, locations, prices or shop data to a prompt. `ai_calls` stores tokens, latency and outcome, never prompt text.

| Variable                             | Where                                                                     | Meaning                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`                       | Render env, `.env`                                                        | `gemini` or `fake`. **Required in production**: the API refuses to start without it. `fake` (the local default) never calls the network. |
| `GEMINI_API_KEY`                     | Render env (secret), GitHub `production` environment secret, local `.env` | Required when the provider is `gemini`. Never commit it.                                                                                 |
| `GEMINI_MODEL`, `GEMINI_EMBED_MODEL` | Render env, `.env`                                                        | Defaults `gemini-3.1-flash-lite` and `gemini-embedding-001`.                                                                             |
| `EMBED_THRESHOLD`, `EMBED_MARGIN`    | Render env, `.env`                                                        | Defaults 0.70 and 0.04. Re-tune with `npm run eval:resolve` after any model change.                                                      |

Commands (they read the key from your `.env` or the environment; none prints it):

```sh
npm run ai:models             # lists the models your key can use; pick names from here
LLM_PROVIDER=gemini npm run ai:embed-catalog   # embeds items whose text changed (about 2 minutes the first time)
LLM_PROVIDER=gemini npm run eval:resolve       # dev (81) and holdout (62) queries through the whole pipeline, see docs/evals.md
```

`EVAL_SET=dev|holdout|all`, `EVAL_KINDS=variant,ambiguous`, `EVAL_AI_PAUSE_MS` (default 5000) and `EVAL_DB=testcontainers` are described in `docs/evals.md`. Reports go to `evals/reports/` (git-ignored except `sample.json`). `eval:resolve` clears `query_cache` and `ai_calls`, so run it against a local database, or with `EVAL_DB=testcontainers`.

**Watching it.** `GET /admin/ai/stats` (admin token): answers by step, LLM fallback and cache-hit rates, average tokens per LLM call, p95 latency, errors, invalid outputs and breaker skips, for 24 hours and 7 days. The breaker opens after 5 failed calls in a row and AI is skipped for 60 seconds; searches keep working from the dictionary. A 429 in the logs (`AI call failed`, `status: 429`) means a free-tier rate limit.

**Cached answers.** They expire (30 days; 1 day for "nothing fits") and carry the catalog version, so a changed `catalog.seed.json` retires all of them by itself. To forget one wrong answer: `curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/ai/cache?q=xyzzy%20plugh"`.

**After a big catalog change:** run `npm run seed:catalog`, then `npm run ai:embed-catalog`. Review `suggested_synonyms` (`SELECT term, i.slug FROM suggested_synonyms s JOIN items i ON i.id = s.item_id`) and add good pairs to `catalog.seed.json` by hand.

## GitHub: the `evals` environment

The `evals` workflow needs a GitHub environment named `evals` with a `GEMINI_API_KEY` secret (Settings, Environments, New environment, add the secret). It must be a key from a **separate Google project** than production's. Without it the job fails with "GEMINI_API_KEY missing". Run it by hand from Actions, Evals, Run workflow.

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
