# ADR-0059: API hardening: limits, headers, strict input

Status: accepted. Builds on ADR-0058 (per-IP limits, `trust proxy`) and ADR-0017 (CSP).

## Context

After the login fix (ADR-0058) the expensive routes still had no limits (a signed-in client could call `/search` or `/lists/sort` in a loop and spend the model and embedding quota), security headers existed only on `/` and `/app`, request schemas silently dropped unknown fields, and the push allowlist accepted every `*.googleapis.com` host.

## Decision

1. **Limits on the dear routes**, per user and per IP, counted with the store from ADR-0058 (Redis, in-process fallback, never fail open), `429` with `Retry-After`. Every call counts, refused or not. A user is identified once before the routes run, so the limit follows the user and a fresh login does not reset it.

   | Route                                | Per user | Per IP | Window |
   | ------------------------------------ | -------- | ------ | ------ |
   | `GET /search`, `POST /items/resolve` | 30       | 60     | minute |
   | `POST /lists/sort`                   | 10       |        | minute |
   | `POST /route/plan`                   | 20       |        | minute |
   | `POST /requests`, `POST /photos`     | 20       |        | hour   |

   Plus 300 a minute per IP for every API route. `/health` and the static web app come before it and are not counted. The errand and list hourly limits in their services stay. Paths match without case and without a trailing slash, as Express does, so `/SEARCH` is not a way round.

2. **Security headers on every response**, from the first middleware (404s, 400s and 429s too): HSTS `max-age=31536000` (no `preload`, no `includeSubDomains`), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `default-src 'none'; frame-ancestors 'none'` for the API (the web routes replace it with the page policy), `Permissions-Policy` with `geolocation=(self)`, `camera=(self)`, `microphone=()` and 18 other features off, COOP and CORP `same-origin`.
3. **`Cache-Control: no-store` is the default** on every API answer (nearly all of it is one person's data). Hashed assets and the public shop logo set their own. Private photos moved from `private, max-age=3600` to `private, no-store`: they cost one query each time now, which is fine for a picture seen once per search.
4. **CORS: none.** No `cors` package, no `Access-Control-*` header on any answer, a preflight gets none either, so a browser blocks every cross-origin call. **No cookies:** auth is the `Authorization: Bearer` header only, nothing sets a cookie, and a request with only a cookie is a 401. A cross-site page cannot make the browser attach a header it does not know, so CSRF has nothing to ride on; no CSRF token is needed. Tests prove all of it.
5. **Push endpoints (SSRF):** exact hosts only: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com` (the `*` needs at least one label), https, port 443 or none, no credentials. IPs, `localhost`, private ranges and every other host fail. The old pattern `*.googleapis.com` let anyone register a `*.storage.googleapis.com` bucket they own.
6. **Strict input.** Every request schema is `z.strictObject` (body, query, nested): unknown fields are a `400 invalid_request`. A test reads the route files and fails on `z.object`. Gaps closed: `/errands/:id/answer` `text` had no length limit, the phone had none, `/route/plan` took unlimited `shopId` and unknown fields, admin `?q=` and `?hours=` were parsed by hand, `/shops/me/demand` ignored unknown query keys, `/account/logout` and others dropped unknown fields.
7. **Errors:** every error body is `{"error":{"code","message"}}`; an unexpected error is `internal` / "Something went wrong" and nothing from inside (message, stack, SQL code, host) leaves the process. Tests throw secrets and database errors and check the text.
8. **Authorization matrix:** one integration test with two customers and two shops walks every route with an `:id` (requests, pings, orders, lists, list pings, errands, photos, pickups, packing) and checks: no login 401, another user of the same role 404 `not_found`, wrong role 403 or 404, a malformed id 404 (never 400 or 500), and that nothing changed afterwards. Other people's saved address, photo, request, errand and list passed as an input are refused.
9. **The events ticket** was already right and is unchanged: 32 random bytes, stored only as a hash, 60 seconds, `GETDEL` so one use, tied to the user who asked, and the token itself is never accepted in the URL (`realtime.int.test.ts`).

## Alternatives rejected

- **`express-rate-limit`, `helmet`, `cors`.** Not in the brief; the limiter and the header list are small, and no `cors` is the point.
- **Limits keyed on the token.** A second login would reset them. They key on the user id.
- **Limit after the route's own auth.** That would mean passing the store into eight routers; one middleware in front keeps the table in one file.
- **A CSRF token.** No cookie, no CSRF (item 4).
- **`z.object().strict()` on each schema.** Easy to forget; `strictObject` plus the scan test is not.

## Consequences

- All simulated shops share one IP when the simulator runs on one machine (the live demo runs it from a laptop). Measured with 10 shops at real reply times, a busy 3-minute demo (15 single requests, a list, a delivery order, every asked shop answering): the simulator made 30 calls from its address, **peak 17 a minute**; a customer polling every 3 s from another address peaked at 29. Even with the presenter's own browser on the same laptop (a few screens polling every 5 to 15 s) the address stays far below 300, so simulated shops are **not** exempt from the baseline. Calls per search are bounded by the fan-out (at most 10 answers), not by the number of simulated shops. If a demo ever needs more, exempt only users who own a server-minted simulated shop (`shops.is_simulated`), keep their per-user limits, and test that a real shop on the same IP is still limited. The simulator no longer treats a `429` or a 5xx on its start-up check as "this shop is gone". Re-measure with `MEASURE_SIM_RATE=1 MEASURE_SIM_OUT=<file> npx vitest run apps/simulator/src/rate.int.test.ts`.
- A client that sent extra fields now gets a `400`. The web app and the simulator were checked by the e2e run.
- Streams already open outlive a logout (a ticket is checked once, at connect); they carry only ids as hints. Not changed here.
- The per-user limits count in Redis, so they hold across instances; with Redis down each instance counts alone (limits then multiply by the instance count, never vanish).
