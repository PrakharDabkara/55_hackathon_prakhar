# Runbook (v1)

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
