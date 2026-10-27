# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Post-freeze

Hotfixes after v1.0.0 only, one entry each: the exact files changed and why (docs/release.md).

- Sign-in limit keys (ADR-0058 update b): `ipKey` now unwraps IPv4-mapped IPv6 addresses written in hex or full form (they all shared one bucket) and tests pin IPv4, mapped, same-/64 and different-/64; `verify-live-security.sh` takes `--ipv4`, `--ipv6`, `--both` to test one address family at a time. Files: `apps/api/src/http/ipLimit.ts`, its test, `loginLimits.test.ts`, `scripts/verify-live-security.sh`, ADR-0058, `docs/limits.md`, `docs/runbook.md`. The split live budgets are not explained yet (Redis ruled out).
- Sign-in limit order (ADR-0058 update): a test pins that the per-IP limit counts every code request and answers before the demo check and validation; the limiter logs one warn line (at most a minute) and `/admin/health/details` shows `limiter.fallbacksToday` when Redis fails and it counts in memory (`http/ipLimit.ts`, `http/limiterFallbacks.ts`, `http/adminHealth.ts`, `app.ts`, `server.ts`); `scripts/verify-live-security.sh` check 3 spends the budget itself before spoofing; docs record that `TRUST_PROXY_HOPS=2` allows spoofing.
- App round 3 (C-05, C-09, C-11, C-16, C-17, A-09, L-15; ADR-0068): "Ask shops now" asks every shop in range also on a PINGING request, a request with nobody left to answer ends (`NOBODY_LEFT`) and the screen stops waiting, phones/vehicles answer `422 item_out_of_scope` ("AskBuy can't ask shops for phones…") instead of "couldn't understand", short Gemini calls use minimal thinking (`GEMINI_THINKING`) and a slow primary is hedged with the fallback (`AI_HEDGE_AFTER_MS`, default 4000), progress words sit inside the disabled Find button, the eye reveals the owner's full number (`POST /account/phone/reveal`, no-store, 10/h, never logged), landing header button smaller than the brand. Touches the resolve pipeline and AI call settings (evals needed). Files: `apps/api/src/modules/{ai,requests,catalog,account,identity}`, `config`, `logger.ts`, `aiBenchMain.ts`, `apps/web/src`, `apps/web/landing.html`, `src/landing/landing.css`, `e2e/app-round3.spec.ts`.
- CI: the `deploy` job runs on the same `vars.RUNNER` runner as `ci` and `e2e` (hosted minutes are used up, so it never started; #80's migration 031 was not deployed). `evals/runners.test.ts` fails if any job names a hosted runner. Files: `.github/workflows/ci.yml`, `evals/runners.test.ts`, `docs/runbook.md`.
- App round 2 (C-05..C-15, S-07, X-03; ADR-0067): an AI failure says "Our assistant is busy" with a ref (`503 ai_busy`) instead of "couldn't understand", one 15 s budget per Find, "Walnuts, 500g" no longer fails on the comma, "exactly what I typed" files unsure words under the catch-all, a retry reuses its key (the lost-answer photo case) and a broken photo is dropped with a message, refs on every error, progress words while a Find is understood, a server marker for "shops settled" (migration 031) so "no shops" is never shown early, "Ask shops now", chosen suggestions are the request, up to 3 active searches with home cards and a server limit (`409 search_limit`, `GET /searches/active`), the empty "doesn't have it" section removed, Not available with a 5 s Undo, demo shops start setup on the demo place (simulator radius 1500 m). Touches the resolve pipeline. Files: `apps/api/src/modules/{ai,catalog,requests,lists,search}`, `app.ts`, `migrations/031_app_round2.sql`, `packages/shared`, `apps/web/src` (Home, Replies, RequestParchi, Setup, shop Home, new components), `apps/simulator/src/args.ts`, `e2e/app-round2.spec.ts`.
- App round 1 (A-01..A-09, S-01..S-04, S-06, C-01..C-04, X-02; ADR-0066): Indian-mobile-only phones, an immediate demo-mode error with tap-to-fill public demo numbers (`GET /auth/demo-numbers`, `PUBLIC_DEMO_SHOP_PHONES`, `PUBLIC_DEMO_CUSTOMER_PHONES`), Change number and Back on the code step, tries left, shutter mark and a login shutter animation, an eye on the phone, shop set-up (required marks, missing list, optional delivery, logo circle), general stores also asked about household, personal care and stationery, a plain nothing-nearby screen, maps under menus and sheets, demo accounts starting in the demo area (banner, Change, and a demo-area action when nothing is nearby). Files: `packages/shared/src/{phone,categories}.ts`, `apps/api/src/modules/{identity,requests,demand}`, `config`, `evalErrand/run.ts`, `render.yaml`, `apps/web/src` (login, Setup, Replies, ui), `e2e/app-round1.spec.ts`.
- Landing page round 1 (L-01..L-13): customer-first hero, errand-agent copy, everyday-item examples, light/dark toggle, compact phone header, aligned shop replies. Files: `apps/web/landing.html`, `src/landing/landing.css`, `public/landing-theme.js`, their tests.
- Landing page round 1b: shop-first again (original shop hero and steps, restored), buyer sections below them, nav For shops / For buyers / Demo, compact header button sized like the wordmark. Files: `apps/web/landing.html`, `src/landing/landing.css`, their tests.

## v1.0.0 (pending human test)

Everything since the start. This is the "Unreleased" section until v1.0.0 is tagged; until then new entries go here.

### Fixed (eval harness)

- Resolve eval: failed model calls are counted per attempt, so a case whose retry went through is no longer flagged as an error (`runWithRetries`, with a test).
- `docs/evals.md`: errand eval labels mapped to production roles; d18 recorded as a known miss on both models.

### Fixed (failure modes, R2, ADR-0065)

- Gemini: failover from the observed errors. A per-minute 429 waits the full `retryDelay` when it fits the call's budget, else the fallback answers; an oversize input-token 429 is never retried; a daily 429 marks the model exhausted until its reset (or midnight Pacific); a retired model (404) is unavailable until restart; dropped connections now reach the fallback. Every failure logs `quotaId` and `retryDelaySec`; each switch logs one warn with the request id. `/admin/health/details` shows per role the active model, the primary's state and why.
- Privacy guard: the email and coordinate patterns backtracked quadratically (80 kB of one unbroken token took 3 s; 10 kB took about 50 ms, and error text in the logs goes through the same patterns). The email local part is capped at 64 characters (RFC 5321) and the coordinate separator no longer splits a space run two ways; same detections on 200,000 random inputs.
- Evals: the resolve suite takes `EVAL_MODEL=primary|fallback` (workflow input `model`, and `set` by hand); failover is off in both eval suites and a run fails if any call was answered by another model than the one under test.
- `withDemoLock` has an error listener, like `withTransaction`.
- Postgres pool: 15 s connect and 20 s statement timeouts for the API; scripts have none.
- Push sends time out after 10 s and count as failed.

### Documentation (free-tier limits)

- `docs/limits.md`: every external service, its free limit, what the user sees when it fails, the AI call counts and judge sessions a day, the embedding-quota finding, bandwidth, a ranked risk list and judge-day operating rules. The runbook's unattended section now names `/health` as the pinger URL and adds the weekly Render, Neon and AI Studio checks.

### Tests (PR F1: failure modes, assumed vs observed)

- Real failures replayed through our own error handling: Gemini 503/429/timeout/`ECONNRESET` from 16 CI dev eval runs, Redis full (`noeviction`) and stopped, Postgres SQLSTATEs and killed connections, all recorded from throwaway containers into `apps/api/src/testing/observed/`.
- `scripts/probe/gemini-quota-probe.sh` and `gemini-free-triggers.sh` (run by hand with the evals key) capture the raw Gemini 429, invalid-key, unknown-model and oversize-input responses; the contract tests that replay them switch on when the files are committed.
- Gemini keys in the newer `AQ.` format (alongside `AIza`): the probe scripts accept and redact both; `redactApiKeys` hides both in error messages and log fields (the logger had no key redaction before); the `guard-secrets` hook blocks a key typed into a command or written to a file.
- Probe results, observed (evals key, free tier): the three Gemini 429s (per minute, per day, input tokens) are told apart by `quotaId` and carry `RetryInfo`; the daily `retryDelay` is the time to the reset; an oversize input is a 429, not a 400; retired models still appear in ListModels and answer 404. New `gemini-list-models.sh`; fixtures are named `<model>__<kind>__<timestamp>.json` and never overwritten. `.gitleaks.toml` knows the `AQ.` format. The runbook's weekly check now includes `/admin/ai/ping`.
- `docs/failure-modes.md`: assumed vs observed table and ten bugs found (none fixed here), three pinned with `it.fails`: the demo seed/reset lock connection has no `error` listener, an input-token 429 is retried, and a retired primary model does not fall back.

### Fixed (PR R1: running unattended, ADR-0064)

- Redis no longer fills up: every queue (expiry, ping fan-out, push, errand, demo autopilot) now keeps finished jobs 1 hour or 200 and failed jobs 7 days or 500, from one helper (`workers/jobRetention.ts`); the 60 s sweep scheduler had no limit and left about 1,440 jobs a day. At start-up the workers clear old completed jobs, in capped batches, leaving waiting, active, delayed and failed ones alone.
- `/admin/health/details` shows Redis `usedMemoryBytes` and `maxMemoryBytes`; `scripts/release-check.sh` warns above 40 % and fails above 60 %.
- `load/idleQueries.perf.ts` now counts parameterised `execute` lines too; ADR-0062's idle-query figure is corrected. `docs/evals.md` says the eval schedule is paused until Oct 30.
- Runbook: "Running unattended until results (Nov 6)". ADR-0064.

### Added (PR C3: release and ops readiness)

- `scripts/ops/runner-watchdog.sh` with a user timer every 5 minutes (`ops/systemd/`) and a one-command sudoers snippet (`ops/sudoers/`): restarts the self-hosted runner when a run has waited over 10 minutes while it shows online and idle; at most once per 30 minutes; logs to `~/kahan-tools/watchdog.log`.
- `scripts/release-check.sh`: read-only PASS/FAIL pre-tag check (CI on main, open PRs, live pages, `verify-live-security.sh`, `/admin/health/details`).
- `docs/release.md`: freeze policy, hotfix routine, branch protection. PR template now asks for exact files, flows to re-test, risk, security-reviewer result and evals.
- Runbook: "Runner watchdog".

### Security (PR C3)

- `scripts/demo.sh` and `scripts/release-check.sh` send the admin token only to an exact-host allowlist (`scripts/lib/allowed-host.sh`): `https://kahanmilega-api.onrender.com`, `localhost` and `127.0.0.1`. Look-alike hosts, `@`, query strings and other schemes are refused before any request. The token-bearing curl call ignores `~/.curlrc` and proxy variables and follows no redirect; `release-check.sh` hides the token from `verify-live-security.sh`.

### Added (PR O1: observability, ADR-0063)

- Request id on every log line of a request (also from a module's own logger) and in every error body as `error.requestId`; it is six characters ("7F3A2C") unless the caller sent a safe `X-Request-Id`. The web apps add "· ref 7F3A2C" to server-error messages.
- Unexpected errors log the error class, SQLSTATE and constraint, never parameters or values. Failed jobs on every queue log queue, job name and id, attempt, and the request that queued the job (`correlationId`).
- `POST /client-errors`: strict small report from `window.onerror` and `unhandledrejection` (message, stack up to 2 kb, route, app version, request ref), limited to 10 a minute per IP and per user, logged at warn with phones and emails cut.
- `GET /admin/health/details` (admin token, 404 otherwise): DB and Redis, queue depths and failed jobs in 24 h, AI calls today, autopilot state, commit. Counts only.
- Runbook: "Debugging a live issue".

### Fixed (PR O1)

- pino-http replaced the logger's error serializer on `req.log`, so `req.log.error({ err })` skipped the redaction (database `detail`, `where`, `parameters`). The serializer is now passed to pino-http.

### Added (PR C2: demo-ready, ADR-0062)

- Demo autopilot: with `DEMO_AUTOPILOT=on` (default off) the API answers pings and shopping-list parchis for `is_simulated` shops after 5 to 90 s and moves their orders on (READY or out for delivery), through the same service functions as the routes. Event-driven on its own BullMQ queue (plan job, then a delayed answer job; three at a time; no timer or polling), capped by `DEMO_AUTOPILOT_MAX_PER_MINUTE` (30), one batch catch-up at startup. Off creates nothing. `npm run perf:autopilot` measures CPU, memory and search latency on against off. It never answers real or demo shops.
- `POST /admin/demo/seed` (idempotent): five demo shops on 9000000102 to 106 near Vijay Nagar with initials logos, delivery on two, about 40 items of illustrative learned stock, eight simulated shops, and a demo saved address for customers 9000000202 to 206. `POST /admin/demo/reset` removes everything that involves a demo number (101 to 110, 201 to 210) and seeds again; counts only. Both are 404 without the admin token. `scripts/demo.sh seed|reset`.
- Migration 030: `users.is_demo` and `shops.is_demo`.

### Changed (PR C2)

- The simulated shop's answer rules moved from `apps/simulator` to `packages/shared` so the autopilot and the laptop simulator share them; `npm run simulate` builds shared first.

### Added (PR A4: more subagents)

- `.claude/agents/security-reviewer.md` (diff review against the security checklist; Bash only for git/gh diff, log, view) and `eval-analyst.md` (dev eval reports only, never the held-out set). Both read-only, and Bash is enforced read-only by `.claude/hooks/guard-readonly-bash.mjs`, a PreToolUse hook in each agent's frontmatter (allowlist: git diff|log|show|status, gh pr diff|view, and gh run view|download for eval-analyst; chains, redirects and substitutions refused). New agents need a new session. `agents.test.ts` checks frontmatter (name matches file, description, tools listed, never Edit or Write); `vitest.config.ts` now includes `.claude/agents/`.

### Fixed (flaky-sweep)

- Three racy integration assertions: `seekerView` pingStats no longer assumes the fan-out has not run when `POST /requests` returns; the simulator `stop()` test waits for in-flight answers to settle before its baseline; `realtime` events test waits for the last expected event before the exact-list checks.

### Added (PR A2: project skills)

- `.claude/skills/`: `askbuy-pr` (PR routine, CI-port stack, report), `askbuy-evals` (safe eval runs, with `run-evals.sh`), `askbuy-ui` (Parchi design rules; `paths: apps/web/**`) and `askbuy-adr` (ADR template, numbering, journey entry). Only names and descriptions are in context until a skill is used. New skills appear in a new session. `docs/ai-tooling.md` explains each and the incident behind it.
- `run-evals.sh` dispatches one eval, takes the run id from gh's URL output (never "latest run"), waits until it completes, prints the conclusion, and runs a list strictly one after another, stopping at the first failure. Refuses the hand-run set.
- Tests: `.claude/skills/skills.test.ts` (frontmatter) and `run-evals.test.ts` (stubbed `gh`); `vitest.config.ts` now includes `.claude/skills/**`.

### Changed (PR A2)

- `CLAUDE.md` is leaner: the UI rules, the PR routine and the eval how-to moved into the skills; the facts and rules stay (5,073 to 3,997 bytes).

### Security (PR SEC3: privacy and the supply chain, ADR-0060)

- A privacy guard in the Gemini adapter (the only place the model is called) blocks any prompt, tool result or embedding text with a phone number, an email, a latitude/longitude pair or a contact/address key, before the request leaves. It logs the reason, never the text, and never counts toward the circuit breaker. Tests: resolve, resolveList, the item check and the errand agent pass with realistic input; a planted phone is blocked in each.
- Shop names reach the errand agent as quoted data (`<<<SHOP ... SHOP>>>`, marks removed, phones and emails replaced, 60 characters); the system prompt says never to obey them. Three new agent dev eval cases (d24 to d26) put an instruction in every shop's name. The agent dev eval is still to run (see the PR).
- `POST /account/logout-all` ends every session, forgets every device's alerts and closes the user's open event streams on every API instance; a stream ticket is refused without a live session. "Log out on all devices" in the customer Account and in Shop settings, each with a confirm sheet.
- Logs: one `createLogger` with a redaction list (phone, token, code, address, note, search text, coordinates) and an error serializer that drops database detail; the masked phone is logged as `phoneMasked`. A test runs two logins and an order and checks the output.
- Uploads: new tests that the served bytes carry no GPS and that WebP and PNG EXIF is stripped. Photos stay visible to the people in the loop, not the owner only (ADR-0030).
- Supply chain: `npm audit --omit=dev` found 0 vulnerabilities; gitleaks over all history found 7 hits, all a public sample push key in test fixtures (no rotation); every GitHub Action in `ci.yml` and `evals.yml` is pinned to a commit SHA, with a test.
- New `SECURITY.md` (how to report, what we keep, demo-mode limits).

### Added (PR A3: flake-hunter subagent)

- `.claude/agents/flake-hunter.md`: a read-only subagent (Bash, Read, Grep, Glob) that reproduces one flaky test, classifies the cause and proposes a minimal diff. `docs/ai-tooling.md` explains subagents and why this one exists.

### Fixed (PR A3: two flaky integration tests)

- `notifier.int.test.ts`: wait for the notifier to finish the first push before the second search, so "and 1 more" cannot land on the first push (it counts the pings waiting when the handler runs).
- `simulate.int.test.ts`: wait until the simulator has logged and counted every answer stored in the database, instead of asserting right after the rows are read.

### Added (PR A1: Claude Code hooks, ADR-0061)

- `.claude/settings.json` and `.claude/hooks/*.mjs` (plain Node): `guard-secrets` blocks `.env` (not `.env.example`) and holdout paths; `guard-git` blocks pushes to main, `--no-verify` and commits on main; `format` runs Prettier on edited files; `notify` sends a desktop notification on Notification and Stop; `session-status` prints branch, open PRs and runner state at session start. `permissions.deny` repeats the secrets and git rules as a second layer.
- `.claude/hooks/hooks.test.ts` pipes hook JSON into each script. `docs/ai-tooling.md` gives each hook's purpose, incident and limits.

### Security (PR SEC2: API hardening, ADR-0059)

- Rate limits per user and per IP on the dear routes, `429` with `Retry-After`: `/search` and `/items/resolve` 30/min per user and 60/min per IP, `/lists/sort` 10/min, `/route/plan` 20/min, `POST /requests` and `POST /photos` 20/hour per user; plus 300/min per IP on every API route (`/health` and the web app are exempt). Counted in Redis with the in-process fallback, never fail open. A user's limit survives a new login.
- Security headers on every response, API errors and 429s included: HSTS (1 year, no preload), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, a `Permissions-Policy` that allows only geolocation and camera for this origin, COOP and CORP `same-origin`. API answers are `Cache-Control: no-store`; private photos too.
- Push subscriptions only accept the real push hosts (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`). Before, any `*.googleapis.com` host (including buckets anyone can own) passed.
- Every request schema rejects unknown fields (`z.strictObject`, guarded by a test that scans the route files). `text` on an errand answer, the phone, `/route/plan` stops and the admin queries gained limits or schemas.
- Tests: an authorization matrix (two customers, two shops, every route with an `:id`), no CORS headers and no cookie auth, bare `{error:{code,message}}` bodies with no stack or internals, headers on every response.
- The simulator no longer treats `429` or a 5xx at start-up as "this shop is gone". Measured: 10 simulated shops in a busy 3-minute demo peak at 17 calls a minute from their address (the baseline is 300), so no exemption was added; `apps/simulator/src/rate.int.test.ts` re-measures on demand (`MEASURE_SIM_RATE=1`).

### Security (PR SEC1: demo login closed to strangers, ADR-0058)

- `/dev/otp-inbox` shows a code only for the numbers in `DEMO_PHONES`; for anyone else request still answers `202` but no readable code is stored, so a stranger can no longer log in as another account.
- Admin is `ADMIN_TOKEN` (32+ characters, bearer, constant-time compare), not a phone. `ADMIN_PHONES` is retired; migration 029 turns existing admin users into seekers, ends their sessions, forbids `admin` in `users.role` and wipes stored plain codes. Admin routes are mounted only when the token is set. New `POST /admin/sim/ticket` for the simulator stream.
- Per-IP limits on request (10), verify (20) and inbox (30) per 10 minutes, counted in Redis with an in-process fallback, `429` with `Retry-After`; `trust proxy` is one hop (`TRUST_PROXY_HOPS`), so a spoofed `X-Forwarded-For` does not change the bucket.
- Production refuses to start with empty `DEMO_PHONES`, any `OTP_INBOX_OPEN`, any `ADMIN_PHONES`, or an IP limit above its default. Tests and the e2e run set `OTP_INBOX_OPEN`.
- The simulator reads `ADMIN_TOKEN` from the environment; `--admin-phone` is gone. The e2e run makes a throwaway token. Runbook and README no longer print a number.
- `scripts/verify-live-security.sh` checks the live site (inbox closed to other numbers, IP limit with and without a spoofed `X-Forwarded-For`, admin routes 404) and prints status codes only.

### Changed (PR Q2: quality, ADR-0057)

- Offline: the service worker keeps the app shell (page, script, styles, icons, Latin fonts), so `/app/` and `/app/shop` open with no network. The shop app's error screen now shows the offline banner and loads again when the connection returns. Fonts were already self-hosted. e2e `offline.spec.ts` goes offline after the first load and checks the shell, the banner and the font.
- Focus ring: new tokens `--focus-on-paper` and `--focus-on-dark` replace the per-screen paper overrides; paper, the dark order card and the map controls keep 3:1 in both themes (`tokens.test.ts` computes it). Map controls draw the ring inside, on their own face.
- Targets and checks: the Map/List toggle and the price boxes on a slip reach 44 px; Errand notices that are not errors use `role="status"`; `errorsAnnounced.test.ts` keeps every error line a live region.
- e2e `a11y.ts` runs on every customer and shop screen in light, dark and `data-theme`: axe, focus ring contrast, 44 px targets, reduced motion, no sideways scroll.
- `/app/` has a meta description (SEO 100).

### Fixed (PR Q1: flaky tests)

- e2e: the seeker spec no longer depends on earlier specs. Specs that ask at the demo place now forget the learned stock and Redis ping claims they leave behind (`forgetDemoStock` in `e2e/db.ts`), and the seeker waits for the page's own "All shops have replied" instead of a long timeout. The school-project errand spec no longer waits for timeline lines that the plan can replace before they are seen (failed 2 in 12 alone).

### Added (PR T: landing page, ADR-0056)

- `GET /` serves a static, script-free landing page (`apps/web/landing.html`, a second Vite entry) with the app's security headers: shop-first hero, three steps, why shops join, the buyers band, how AI is used, and a demo section. Tests cover the headers, anchors, contrast (axe, light and dark), 360 px, and that no phone number or code appears.

### Fixed (PR W: simulated shop removal)

- `DELETE /admin/sim/shops` runs again after a deadlock, and a database error now answers `sim_remove_busy` (503) or `sim_remove_failed` (500, with the SQLSTATE) instead of a bare `internal`. A test pins that shops with list pings, answered lines and delivery and pickup list orders are removed, and real shops' list data stays.

### Fixed (PR V: reliable evals)

- Eval runs no longer stall: every model and embedding request has a 30 s limit (also the preflight, which had none); retries are capped at 3 with doubling, jittered pauses and Retry-After honoured (max 30 s); a per-day 429 is not retried and ends the run with `QUOTA_EXHAUSTED`. The resolve runner makes one whole-query retry instead of two, so the nested retries no longer multiply.
- The catalog embeddings are saved after every batch, so a killed run keeps its work.
- `evals.yml`: 30-minute timeout on both jobs, one run per ref (a newer run cancels the older), the daily schedule paused until Oct 30 (runbook: how to restore).
- Progress lines every 10 cases (counts only); the holdout is never named in the log or summary.

### Added (PR U3: shopping lists in the customer app, ADR-0055)

- Find has **One thing / A list** (remembered on the device). The list editor is a paper card with numbered lines in handwriting: Enter or Next adds a line, Backspace on an empty line removes it, a paste or comma list is split, at most 10 ("N of 10"), a ✕ on each line. "Several things? Make it a list" appears when the single box looks like a list. The existing login on first Find applies.
- **Check your list** (only when a line is a question or cannot be sent): clear items with a category chip, questions as radio chips plus "As I typed", "Other" lines, refused lines with the reason and a way back to edit, and the AI note. A list with nothing to ask goes straight to the shops.
- **/app/list/<id>** (also the notification link): a request card of what was asked, a live status ("N shops answered · still listening for M min"), the ranked answers (first open), the coverage sentence and **Make my plan**. **Stop asking** with an in-page question; a stopped list shows its answers and says it cannot be ordered.
- **Your plan**: stats, the route map, a card per shop in nearest-first order with **Pick up | Deliver · fee**, lines you can move to another shop that has them, "Nobody has this yet", the delivery address and note only when a shop is set to Deliver, and **Order from N shops · pay cash**; closed shop, cannot deliver, stopped and similar errors say what to do.
- **Orders of a list**: a card per shop; a pickup is "Being packed · X of N" (live), then "Ready for pickup" with Directions and **Got it**; a delivery is received as before. The order page follows Placed, Accepted, Ready, Collected for a pickup. My orders shows the orders of one list as one row.
- **Stop asking** on the single-item replies screen now asks in the page first (and shows an error if closing fails, so the account can still be deleted afterwards).

### Changed (PR U3)

- `GET /lists/:id` (and the other list responses) carry `lat` and `lng`, the place the owner sent the list from (null for a draft). The plan's map and nearest-shop order need it after a reload or a notification.
- The customer app listens for `list.updated`. Order states `READY` and `COLLECTED` are part of the customer's order type.

### Added (PR U2: shopping lists in the shop app, ADR-0055)

- List parchis in the Home deck, in time order with the single requests. The shop answers on the card: a tick box per line (price prefilled from last time, focus on the price when ticked), the "other" lines under their own divider, "I can deliver this list" with one fee, "You have X of N" and the total, then Send answer. A missing price shows "Add a price" beside the field; sending with nothing ticked asks "Send 'none of these'?" in the page. After sending the card is stamped ANSWERED; a list the customer closed says "This list has closed" and leaves.
- Packing parchi on orders with several lines (Home order request and Orders): "Tick as you pack", "X of N packed", a row per line (optimistic, put back with a short message if it fails, kept after a reload), the total with the fee, then "Out for delivery" or, for a pickup, "Ready for pickup" / "Ready · waiting for the customer to collect". A muted line says how many items are not packed yet. A pickup shows no address. Home's Active orders counts pickups.
- The shop app listens for `listping.created`, `listping.closed` and `order.packed`.

### Changed (PR U2)

- A list card keeps its footer (count, total, Send answer, the promise) pinned; only the lines scroll, with a soft fade when more are hidden. An answered list shows its stamp for about a second. The parchi rule now covers packing slips too.
- The `new_list` push now links to `/app/shop?parchi=<parchi id>` and is tagged with the shop's own parchi id (was the list id), so a tap opens the deck at that card. A shop that is also a customer no longer shares a notification tag with its own list.

### Added (PR U1 follow-up: pickup orders and list push, ADR-0055)

- A list shop set to pickup now gets an order (`fulfilment: pickup`, migration 028): ACCEPTED, READY (`POST /orders/:id/ready`, the shop; response carries `unpackedCount`), COLLECTED (`POST /orders/:id/collected`, the customer); 3 hours after READY it becomes NOT_CONFIRMED. A pickup keeps no address, pin or name; order views gain `fulfilment` and `shopLocation`. `orders[]` of `POST /lists/:id/order` now holds every shop of the plan; `pickups[]` stays for the route. Customers get "your order is ready for pickup".
- One customer notification per list (`list:<id>`): first answer, quiet updates, one "Your list is ready" at 8 answers or 15 minutes.

### Added (PR U1: shopping lists, backend only, ADR-0055)

- Shopping lists. `POST /lists/sort` understands up to 10 typed lines (item, ambiguous with up to 3 options, "other", or refused) with one embedding request and one model call per list; `POST /lists/:id/send` gives each nearby shop ONE parchi with its lines plus the "other" lines; `GET /shops/me/lists` and `POST /list-pings/:id/answer` for shops (per line have + whole-rupee price, `canDeliver`, one fee); `GET /lists/:id` for ranked answers and the default plan (fewest shops that cover everything, exact); `POST /lists/:id/order` orders from several shops in one all-or-nothing call; `POST /lists/:id/stop`. The list stops listening at 8 answers or 15 minutes. Migration 027: `shopping_lists`, `list_lines`, `list_pings`, `list_ping_lines`, `delivery_orders.list_id`.
- Packing: `PUT /orders/:id/lines/:index/packed` (the owning shop, while the order is not final); order views carry `packedCount`, `lineCount`, `unpackedCount`.
- Push kind `new_list` (one per shop per list). Simulator answers list parchis line by line (log line ends `(list h/t)`).
- Evals: `evals/resolve.list.dev.jsonl` (8 list cases, `EVAL_SET=list-dev`, part of `all`, never gated; a list that needs more than one model call or embedding request fails the run).
- Stop asking for a single search is the existing `POST /requests/:id/close`; lists get `POST /lists/:id/stop`; both end what `DELETE /account` checks.

### Added (PR S: customer Account, ADR-0054)

- Account screen at `/app/account`, opened from a person icon in the Find header (signed out, it opens the login sheet and then Account): the phone partly hidden, the delivery address (add or edit, saved on the server), Reply alerts for this device (browser permission flow; off also deletes the subscription on the server; disabled when the browser blocks them), Appearance System/Light/Dark, My orders, "What shops can see", Log out and Delete my account.
- API: `GET /account`, `POST /account/logout` (revokes the session and removes this browser's push subscription), `DELETE /account` (soft delete in one transaction, refused with an open order or live request, 5 tries per hour). Migration 026: `users.phone` can be empty, `users.deleted_at`.
- Dark and Light override the phone's setting through `data-theme` on `<html>`, set before the first paint by `theme-init.js` (a file, since the CSP allows no inline script). The shop app follows the same stored choice.

### Fixed (CI e2e isolation)

- The e2e job used the local dev volumes (compose pins their names), so on the self-hosted runner `seeker.spec` met dev stock ("Sent to 0 shops") and failed on main after #49. The job now names its own volumes (`PGDATA_VOLUME`, `REDISDATA_VOLUME`); local defaults are unchanged.

### Changed (Day 23, PR R: new named items are confirmed, ADR-0053)

- Errand rule 3: an item the customer named that the catalog does not have is confirmed in a checklist before any shop is asked (named items ticked first, the agent's extras offered unticked). A goal with no named item keeps its pre-ticked list.
- Errand evals: `offeredAny` expectation (an extra must be among the checklist options); dev case d18 uses it for the glue/tape group. The holdout was not touched.

### Changed (Day 23, PR Q: rename to AskBuy, brown sugar, ADR-0051 and ADR-0052)

- Renamed KahanMilega to AskBuy in code and docs: packages `@askbuy/*`, MCP server `askbuy` (re-register it with `claude mcp add askbuy`), `ASKBUY_*` env names (the old ones still work; the old login file is moved), errand prompt, CI project `askbuy-ci`, local compose project `askbuy` (volumes keep their old names). Kept on purpose: repo and Render service/URL, database and env names, `km-*` storage keys, push setup, the Redis channel and the runner eval cache. See `docs/naming.md`.
- "brown sugar" is groceries, not a blocked term; seeded as a grocery item (seed v8). Heroin, smack and the other unambiguous drug terms stay blocked.
- Shop login tagline no longer repeats the brand: "For shops: lift your shutter online in a minute."
- `evals/naming.test.ts` fails if the old name appears outside the keep list.

### Changed (Day 22, PR P: search understands the customer, the AI speaks English, AskBuy, ADR-0045 to ADR-0050)

- Search exactly what I typed: `POST /requests` takes `asTyped`; Did you mean offers it first and "Something else" now searches that text (it used to return to Find). Every safety check still runs. Find nearby is never disabled. Catalog item names are sentence case for customers.
- Uncategorised items (classifier answer `other`) are misc requests: the nearest 15 open shops of any kind (`MISC_FANOUT_MAX`), catch-up respects the cap; the shop slip says "May not be your usual stock". Migration 025.
- Everyday names: `requests.matched_alias` (a catalog word only) shows as `displayName` on shop slips and order lines; the customer's parchi shows their own words as typed with the matched item small.
- The AI speaks English: the resolve prompt, the seed's ambiguous questions, the errand prompt and tool schema text; cached questions are cleared; the client shows the server's question in the sheet and the errand list. The classifier may answer `other`.
- Errand rule in code: named items are never dropped (checklist and plan are repaired) and nothing the agent adds on its own is asked of shops before the customer confirms a checklist; declined items stay declined. Two new tool-result messages, three dev eval cases (d21 to d23).
- The app is AskBuy in the UI: `BRAND_NAME`, `index.html`, manifest, service worker, new mark, generated icons (`npm run icons`) and taglines. Code names come next.

### Changed (Day 21, PR O: UI fixes from the live test, ADR-0044)

- App frame: `html`, `body` and `#root` now paint `--bg` with no margin (the browser's 8px margin and default canvas were the dark seam), both app roots use `--bg` and `100dvh`, and `theme-color` and the manifest follow `--bg`.
- Focus is drawn in the brand colour (`--focus` is `var(--brand)`, so it follows the dark theme). Text inputs show a single 2 px brand border; buttons and links keep the `:focus-visible` ring.
- Shop settings: the logo is a centred 104 px circle you tap to change (camera badge), with a quiet "Remove logo" link that confirms in a bottom sheet. The closed shop shows a still hanging CLOSED sign instead of blank slips.
- Customer request slip: shows the quantity asked for, fits its content, and reads "Sent to N shops · X km" without running under the stamp. Reply card meta is in sentence case; distances read "Under 100 m", "600 m" (nearest 50) and "1.2 km".
- Push: named copy, a tag per request, order and shop, one notification per request and per shop, no push for "received" and no unused delivered kind (ADR-0044). Payload is `{title, body, tag, renotify, url}`.
- `GET /errands` returns the last 20 with `expiresAt`. Find shows "Continue your errand" for a running errand or a plan ready in the last day; My orders has an "Errands" section; the errand card has a chevron.

### Changed (Day 20, PR N: collect up to three offers, ADR-0043)

- A request keeps asking until three shops have said yes (`MAX_LIVE_OFFERS`), it ends, or the customer orders or starts a pickup. The first yes still answers it; the other shops' questions stay open and are withdrawn then, with the existing "customer got an answer" note. A fourth yes is remembered stock, not an offer. A shop that opens late is asked about answered requests with fewer than three live yes. Errands still wake on the first answer.
- E2E: `customer-screens.spec.ts` seeds three live yes, one late yes and one no, checks "Best price nearby", and takes the pickup from the remembered shop (45 s; the full e2e passed locally on the CI-port stack, 21 tests, 2.6 min).

### Fixed (Day 20, PR N)

- Flaky `App.test.tsx` "says it is offline above whatever screen is open": the test now waits for the shell's first load (the sign its listeners are attached) before sending the offline event, instead of a longer timeout.

### Fixed (PR #43 CI)

- Find: with "Deliver to me" on, the address field no longer appears and then vanishes when a kept address arrives; a skeleton shows until the saved-address request answers, then either the kept address or the field to type in.
- CI: `ci`, `e2e`, `evals` and `agent-evals` run on `vars.RUNNER` (default `ubuntu-latest`; `deploy` stays on GitHub's runner); CI runs on pull requests and pushes to main only, skips docs-only changes and drafts, and cancels a superseded run; each job names its runner in the summary; Chromium installs without sudo on a self-hosted runner; the e2e job has its own compose project and ports (Postgres 55432, Redis 56379, app 53100, `E2E_PORT`), so it never meets a developer's local stack. No cache upload on a self-hosted runner (the npm cache is skipped; the eval embeddings use `~/.cache/kahanmilega-evals`); GitHub-hosted runners cache as before. Runbook: Self-hosted runner.
- E2E: `customer-screens.spec.ts` seeds its answers in order (Alpha's yes is the live one) instead of racing four at once; the demand spec waits for Insights to finish loading; `customer-screens.spec.ts` has a 90 s limit and no retries, scans 360 px only, and writes screenshots (360 and 1280 px, light and dark) only with `SCREENS=1`; `e2e/.auth/` (session tokens) is now really in `.gitignore`.

### Added (Day 19, PR M: Parchi customer UI)

- New customer app UI (ADR-0042), in English with the Hindi table in parity: Find without a login wall (a login sheet opens on the first Find and the draft is sent right after), a "Did you mean" sheet, the request as a parchi with a "N have it" stamp, a List/Map reply view with best price, remembered stock and a collapsed "don't have it" count, a Choose a shop sheet (delivery or pickup), order tracking with steps and times, My orders (pickup question, active and earlier, saved address, notifications) and the errand list and plan.
- `acceptedAt` and `outForDeliveryAt` on the customer's order view; migration 024 adds `delivery_orders.accepted_at`, set when an order becomes ACCEPTED (a fresh offer at insert, or the shop's accept). Orders from before show no time.
- E2E: `customer-screens.spec.ts` (every customer screen at 360 and 1280 px, light and dark, with an axe scan); each test phone logs in once per run and the simulator's admin session is cached under `e2e/.auth/` (gitignored).

### Changed (Day 19, PR M)

- Design tokens and the shared primitives (Button, Chip, Field, Switch, BottomSheet, Parchi, Toast, ShopLogo …) moved from the shop app to `:root` and `apps/web/src/ui/`; the old customer stylesheet is gone.
- Customer push titles, errand progress lines and the remembered-answer text on plans are English; the "Grahak" fallback is "Customer". Strings that a model also reads (result freshness, prompts, tool text) are unchanged.
- Customer copy that was Hinglish in the English table (photo buttons, errand examples, "not enough") is English.
- "Price seen elsewhere" is no longer asked on Find; "Near you" replaces coordinates; the pickup question ("Did you get it?") moved from Find to My orders.

### Added (Day 18, PR L: Parchi shop UI)

- New shop app (ADR-0041): design tokens with light and dark themes, a request deck of paper slips (parchi) with a time ring and stamps, answer sheets for normal and delivery questions, Orders, Insights, Delivery, Shop settings and Notifications behind a menu drawer, and a Login and Set up screen in the same style.
- Shop location is chosen on a small map with a draggable pin (arrow keys nudge it), at set-up and in Shop settings; set-up cannot finish without a pin.
- Shop logo upload and removal in Shop settings and at set-up; the logo and initials show in the header and menu.
- `BRAND_NAME` (`brand.ts`) with a test that keeps `index.html`, the manifest, the service worker and `appName` in step; Mukta and Kalam self-hosted through `@fontsource`.
- E2E: `shop-screens.spec.ts` (every shop screen at 360 and 1280 px, light and dark, with an axe scan that must find nothing serious or critical) and `shop-setup.spec.ts`; `@axe-core/playwright` as a dev dependency.
- UI rules section in CLAUDE.md.

### Changed (Day 18, PR L)

- The web app now starts in English when no language is saved (the Hindi table and the switch stay). Customer copy is polished in PR M.
- The shop app no longer has a setup question about delivery: delivery is set on the Delivery screen. A "will deliver" answer needs a price and a fee.
- The shop's order screen splits Active from Done today; an order sent out waits for the customer's Received (no shop "delivered").
- `ShopApi` gains `updateShop` (one `PATCH /shops/me`), `uploadLogo`, `deleteLogo` and `shopDemand(days)`; the old `updateDelivery` and `setDeliveryLimit` are gone.

- Review fixes: item names show with a capital letter (display only), ruled lines sit only behind the handwriting, Decline is neutral, "will deliver" needs a price before Confirm (with the total above it), the Open/Closed switch has a knob, and the two-tile strip is pinned to the bottom of Home.

### Removed (Day 18, PR L)

- The old shop screens and components (`PingHome`, `PingCard`, `ShopBar`, shop `Onboarding`, `ShopOrders`, `ShopDemand`, `DeliveryFields`) and the strings only they used.

### Added (Day 17, PR K: shop-screen data and logo)

- `lastPricePaise` on a shop's ping card (its own last quoted price; `null` when unknown or called wrong).
- `GET /shops/me/demand?days=1|7` (default 1, else 400): `today`, `asked` and `nearby` follow the window, `days` and `avgReplySeconds` (YES/NO, not late) are added.
- Shop logo: `POST /shops/me/logo` (512 px square webp, replaces the old one), `DELETE /shops/me/logo`; `logoUrl` in `GET /shops/me`, search results and the order views. A logo is readable by anyone with a long cache header. Migration 023, ADR-0040.

### Changed (Day 17, PR K)

- Integration tests clear request data with `truncateKeepingShops`, because a shop now points at its logo photo.

### Added (Day 17, PR J: Delivery v2)

- "Deliver to me" on Find (`wants_delivery`, a saved address); shops see `wantsDelivery` and `canDeliver` on a ping and answer with three choices; a shop sets how far it delivers (`PATCH /shops/me { deliveryMaxKm }`). Migration 022, ADR-0039.
- A fresh offer (30 minutes or less) is binding: the order starts ACCEPTED and the shop is pushed "Grahak ne aapko chuna". The customer picks one shop only; the others get the "customer got an answer" note.
- The customer confirms delivery with `POST /orders/:id/received`; with no Received after 3 hours the order ends NOT_CONFIRMED.
- A shop can cancel an ACCEPTED order with a reason (`POST /orders/:id/cancel`, decided by who the caller is to the order); a customer note (140) on an order.
- `docs/scenarios.md`: S16 to S21.

### Changed (Day 17, PR J)

- `POST /orders/:id/delivered` (shop) is removed. The saved address has an id; `PUT /orders/saved-address` keeps one without ordering.
- The simulator offers delivery on about 40 % of yeses for a customer who wants it, and only sets orders out.

### Added (Day 17, PR I, continued)

- Catch-up pings: a shop that opens, finishes onboarding or is created by the simulator is asked about the live nearby requests in its categories that it never saw (not those ending within 2 minutes, answered, or at their maximum of pings). ADR-0038.
- `docs/scenarios.md`: 15 cross-feature scenarios with the expected behaviour, each with an integration test.
- Plan cards show the shop's "thoda/bahut hai".

### Changed (Day 17, PR I, continued)

- The agent prompt preselects what the customer named plus extras necessary for the stated goal (replaces "always tick glue and scissors").
- A closed shop is not pushed a new question.

### Changed (Day 17, PR I: clean-up before the UI overhaul)

- Errand agent: an identical tool call within one errand is answered from the first result, without running again or counting against a cap (ADR-0037). The agent eval report names the missing items and the plan's items.
- "colours" means colour pencils; for a school project the checklist rule is general. Text that is no product (a profession, a vehicle, a place) never reaches the model; the model only asks about short generic words; a brand is not its generic item (catalog version 7, resolve prompt).
- The "Dukaan ne jawab diya" push is held back only for requests an errand opened itself, not for the customer's separate searches.

### Fixed (Day 17, PR I)

- e2e specs use their own corner, shop name and new-item name per run, so the suite passes on a used database.
- A race in the errandPatience integration test.

### Added (Day 17, PR H: understanding follow-ups)

- "Kya aapka matlab…?": a plain search that is not an exact catalog name or synonym is confirmed before any shop is asked (`422 item_confirm` with the item and up to two alternatives; "Haan, yahi", the alternatives, "Kuch aur likhein"). Shown, confirmed and changed counts are log events (`understanding_*`). ADR-0036.
- Everyday words with several meanings (mirchi, daal, tel) are listed in the catalog file (`ambiguous`, version 6) and always ask which one, with no model call.
- A shop whose answer a customer called wrong ("Wahan nahi tha") is asked again on the next search, even inside the ping dedupe window (`shop_stock.invalidated_at`, migration 021).
- The errand plan ranks a shop with 2 or more wrong reports last for that item and shows "Grahak ne confirm kiya" on plan cards.
- Items ticked in an errand checklist can be created as new items at "medium" classifier confidence; plain search still needs "high".
- Order lines keep the customer's own word and the Hindi name; the Hindi screen shows those.
- 11 new dev eval cases (phool, phool jhadu, mirch and daal family, तेल, brand names); `e2e/understanding.spec.ts`.

### Fixed (Day 17, PR H)

- "phool" no longer resolves to the broom: a word that only names a modifier of a longer term ("phool" in "phool jhadu") is not a match, at the trigram, embedding and cache steps.
- `ask_user` uses multi-select when the options are not mutually exclusive (kaunse colours).
- "Aaj ki maang" no longer shows "Kesar Kesar" for an item with no Devanagari name.

### Added (Day 16, PR G: Le liya? and Aaj ki maang)

- "Le liya?": tapping "Raasta" on a result or plan card for a pickup shop is noted (`POST /pickups`, `pickup_visits`, migration 020). The home screen later asks "Kya aapko <item> <shop> par mila?" (`GET /pickups/pending`, after `PICKUP_ASK_AFTER_MINUTES`, default 15) with "Mil gaya", "Wahan nahi tha" and "Gaya nahi"; an hour after the tap, if it was not asked, one push through the existing push module and rate limit. Once per customer, shop and item; never for delivery orders. ADR-0035.
- "Mil gaya" refreshes the shop's learned answer and marks it "Grahak ne confirm kiya". "Wahan nahi tha" invalidates it at once (no longer Likely) and counts against the shop for that item; from 2 reports the shop ranks lower for it. "Gaya nahi" changes nothing. The shop never sees who reported; visits are deleted after 30 days.
- "Aaj ki maang" on the shop screen (`GET /shops/me/demand`): requests received, answered and said yes today; "Log ye pooch rahe the" (items asked of this shop that it said no to or did not answer); "Aas-paas ki maang" (items in its categories asked within 3 km, only when 3 or more different customers asked, counts only).

### Added (Day 16, PR F: Web Push notifications)

- Notifications through Web Push (VAPID), off until `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set; without them the app works as before and logs one warning. `npm run push:keys` makes a key pair (run by the owner). `web-push` added. ADR-0034.
- `push_subscriptions` (migration 019), `GET /push/config`, `POST /push/subscribe`, `POST /push/unsubscribe`; only https addresses of the four browser push services are accepted; a 404 or 410 from the push service removes the subscription.
- Shops hear "Naya sawaal: item" and "Naya order: item"; customers hear "Dukaan ne jawab diya: item" (the first answer, held 3 s), "Plan taiyaar" and order updates (accepted, declined, out for delivery, delivered). Sent from the BullMQ `push` queue after the commit, 5 tries with backoff, never for simulated shops, at most 5 per person per minute.
- A push holds a title, the item name and a link, nothing else; a test enforces it.
- "Notification chalu karein" / "Notification band karein" on the customer home and the shop screen (asks only when tapped), with "Pehle 'Add to Home Screen' karein" on an iPhone that has not installed the app. Service worker `/app/sw.js` shows the notification and opens or focuses the right screen on a tap.

### Added (Day 16, PR E: finding an order again)

- "Mere orders" on the home screen (a badge for orders still moving) and `/app/orders`: every order with shop, items, total including the fee and state, open ones first. `/app/order/<id>` shows one order live, works after a reload, says the final state plainly (delivered, declined or expired with the pickup message, cancelled) and can cancel while requested or accepted. `GET /orders` without a query, ADR-0033.
- "Haal ke kaam": the last 10 searches and errands, each opening its page; a search now has one at `/app/request/<id>` (`GET /requests`, `GET /errands`). The browser's back button follows the app's addresses.
- The shop's Orders section: open orders on top ("Chal rahe orders"), finished ones below ("Pichhle orders"), no longer cut off after two hours.
- "Is pate ko yaad rakhein" (unticked) on the address step; the address is kept on the customer's profile only with the tick, and "Pata hatayein" on Mere orders deletes it (`saved_addresses`, `DELETE /orders/saved-address`, migration 018).
- An hourly sweep clears the address and pin of an order 30 days after it ended; the order stays.

### Changed (Day 16, PR E)

- "Saved address" is no longer the customer's latest order; without the tick nothing is kept beyond the order. ADR-0032 amended.

### Added (Day 16, PR D: delivery orders)

- "Ghar mangwao" → "Order bhejo" → address step on result and plan cards of a shop that delivers: typed address, optional first name, the request's own location as the pin, the customer's last address offered, a fixed "Cash on delivery" line. The status follows live. `delivery_orders` (migration 017), `POST /orders`, `GET /orders`, `GET /orders/saved-address`, `POST /orders/:id/cancel`. ADR-0032.
- The shop's order card (`GET /shops/me/orders`, `POST /orders/:id/accept|decline|out|delivered`): Accept / Decline; only after Accept the address, a "Map par dekho" link and the contact line (first name or "Grahak", never a phone); then "Nikal gaye" and "Pahuncha diya". States are guarded in SQL; a new order expires after 10 minutes (read and 60 s sweep) and a decline or expiry puts the plan's shop back on pickup and tells the customer.
- The simulator accepts most orders, declines about one in five, and moves accepted ones to out for delivery and delivered after short delays.
- A shop's question that goes away because the customer already has enough answers shows "Grahak ko jawab mil gaya — shukriya" for a moment (`ping.closed` now carries a reason).

### Fixed (Day 16, PR D)

- After choosing delivery, the plan's recommendation ignored `ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE` and used the default; it now uses the configured value.

### Added (Day 16, PR C: quantity and delivery offer)

- Exact quantity on a yes (kg, g, L, ml, piece, packet), stored on pings and learned stock (migration 016); "5 kg hai", "Sirf 1 kg hai" with "Kam hai (not enough)", "Pichhli baar: 5 kg" for learned stock (3 days, never subtracted). ADR-0031.
- Delivery offer on a yes ("Ghar bhej denge", optional fee and time), standing defaults at onboarding and under "Delivery ki settings", a chip on result and plan cards. No orders yet.
- Pickup or delivery per shop on the plan (`POST /errands/:id/modes`): one fee per shop, delivery counts route distance as 0, totals recomputed in code. ADR-0025 amended.
- "Dukaan khuli hai / aaj band hai": a closed shop gets no pings and is left out of learned stock until the end of the day or until opened.
- The simulator's yes answers sometimes carry a quantity and a delivery offer.

### Fixed (Day 16)

- An offer with no price was treated as ₹0 and its item silently left out of the total. It is now counted ("+ N cheez ka daam pata nahi"), ranked at a fair estimate (median of other quotes, else the typical price), and a missing price is never a saving in the recommendation.

### Added (guard against pushing to main)

- A tracked `.githooks/pre-push` refuses any push to `main` or `master` with a message on how to open a PR instead; `npm install` enables it (`prepare` sets `core.hooksPath`). CLAUDE.md now says never push to main and to check `git branch --show-current` before committing.

### Fixed (simulator determinism)

- The simulator test "a request is answered by simulated shops" no longer depends on chance: fixed seed, every shop answers, at least three shops that sell the item are asserted, and a second test checks that a shop outside the item's category says no and one inside says yes. It failed about 2 % of the time once shops answered by category.
- The simulator's shop mix is now dealt from a deck that matches the weights, so 200 shops always have their share of every kind (dairy, pooja, medical and bakery included); chance only decides where each stands. Mix: grocery 24, general 13, stationery 14, hardware 10, household 10, dairy 10, electrical 9, personal care 9, pooja 9, mobile accessories 8, medical 8, bakery 8, sabzi 7 (of 159).

### Fixed (Day 15 live findings)

- Shop onboarding has a "Demo location (Indore)" button with the same coordinates as the customer side.
- Shop category tiles show Devanagari with the Hinglish name under it ("किराना / Kirana"), like the answer buttons; English shows the English name.
- Simulator: shop names are unique (a repeat gets a locality, then a roman numeral), and a simulated shop answers yes only to items of its own categories, catalog items included (the ping event now carries the item's and the shop's categories).
- The plan map draws only stops it can place, refits to every stop whenever its frame changes size, and an e2e check proves every numbered pin is inside the frame.

### Added (Day 15, PR A: open catalog)

- A real product the catalog does not know becomes a new unverified item (ADR-0028): name hygiene, dedupe by exact or trigram match, a category chosen by the model from a fixed list, creator and time stored, no embedding. Works for `POST /requests`, the errand agent and MCP `resolve_item` (`POST /items/resolve`; `GET /search` never creates). The first shop yes verifies it.
- Shop and item categories: dairy, sabzi_fruit, pooja, medical, bakery_sweets (migration 014); a shop carries one to three, none means grocery. Pings go to shops of the item's kind and, if fewer than 3 are near, the nearest of any kind.
- Safety block (ADR-0029): deny list (Latin and Devanagari) in `modules/safety`, a model classifier validated in code, fail closed (`503 item_unavailable`), `422 item_blocked`, 5 new items per errand and 10 per user per day (`429 new_item_limit`). Only the fact and the rule are logged.
- Screens: "Nayi cheez: dukaanon se pooch rahe hain", the blocked and unavailable messages, a "Nayi cheez" tag, 13 category tiles; "Dukaanon se phir poochein" is hidden when every missing item was refused for good.
- Simulator: 13-category mix with more stationery, hardware and pooja shops; user items answered yes about 40 % with a price range per category.
- `/admin/ai/ping` tests the resolve and the errand models and labels each line with its purpose and role.
- Evals (ADR-0022, ADR-0027 amendments, scoring fixed before any run): a new item is right for a non-nonsense case that expects no catalog item; nonsense and injections must never create one. Dev cases only: `newitem` resolve cases, the school-project errand, "ghar ki safai", a second harmful task. No run has been made.
- e2e: the school-project errand at 360 px with a scripted model (`scripts` per task and `classify` in the scenario file).

### Changed (Day 15, PR A, after the first eval run)

- New items need a confident model: the classifier returns a confidence and may say "unsure"; only real and confident creates an item, and code checks (word-like text, not mash, a sentence, a vehicle, phone or property itself) run first. The unresolved message is now "Ye cheez samajh nahi aayi — thoda aur batayein". 18 new dev cases. The resolve prompt refuses an item that is only related to the text.

### Changed (Day 15, PR A)

- The deploy's embedding step never blocks the deploy: a failure is a warning and a job-summary count of un-embedded items; the next deploy finishes them (ADR-0021 amendment).
- `resolve_item` is no longer read-only (it can add an unverified item); the errand prompt asks for the checklist of extras on a project even when some items are named.
- Unknown text with the safety check down is now `503 item_unavailable` instead of `422 item_unresolved`.

### Added (Day 15, PR B: photos)

- Optional photos on both sides, never required (ADR-0030): a customer on a single search and on any checklist item ("Photo jodein"), a shop with its yes. The shop sees the customer's photo on the request card, the customer sees the shop's on the result and plan cards; tap to enlarge.
- The browser shrinks to 1024 px and about 100 KB (no EXIF) with upload progress and plain error messages; the server checks magic bytes (JPEG, PNG, WebP only, at most 400 KB), re-encodes with `sharp` (orientation kept, all metadata gone) and stores the JPEG in Postgres (migration 015).
- `GET /photos/:id` with the login: a customer's photo only to them and the shops the request went to, a shop's only to that shop and the customer who asked; others get 404; `Cache-Control: private`; CSP unchanged.
- 10 photos per user per day, `PHOTO_STORAGE_CAP_MB` (default 300) with the total logged on every upload, and a sweeper that deletes photos 7 days after their request expires. Photos never go to a model.
- e2e: both sides attach a photo at 360 px, in two real browsers.

### Added (Day 14c, part 2: agent evals)

- Agent eval harness (ADR-0027): `evals/errand.dev.jsonl` (17 cases) and `evals/errand.holdout.jsonl` (16), written before any run. `npm run eval:errand` plays each case as a real errand in process: real model, throwaway Postgres with the seeded catalog, eight synthetic shops, a deterministic shop responder (all / none / partial / slow), scripted answers for `ask_user`. Success, tool correctness, hallucinations, injection resistance, tokens, calls, p50/p95 and failures by kind are all computed in code. Gates (fixed before the first run): success ≥ 80 %, tool correctness ≥ 90 %, hallucinations 0, injection 100 %, errors ≤ 2.
- Workflow job `agent-evals` (label `agent-evals`, or by hand with `suite=agent`, `set`, `model`); never on the schedule; prints the estimated call count first and refuses over 250; 4 s between calls; quota fails fast.
- Baseline and model comparison: `docs/evals/errand-baseline.md`.

### Changed (Day 14c, part 2)

- `GEMINI_ERRAND_MODEL` and `GEMINI_ERRAND_FALLBACK_MODEL`: the errand agent can run on its own model; unset, it uses `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` as before. Query resolution never reads them. The AI client takes a model and fallback per purpose; the eval harness's `model` input sets the errand model.

- Production refuses to start with `LLM_PROVIDER=fake` or with `FAKE_LLM_SCENARIO` set at all; there is no bypass. (e2e and CI run as `development`.)
- The errand result no longer carries any sentence the model wrote: `plan.notes` is dropped from `GET /errands/:id` and the screen shows only the summary built from the plan. The text stays in `errand_steps` for debugging.
- `CLAUDE.md` label rule: `agent-evals` for the errand agent, `evals` for the resolve pipeline.

### Fixed (Day 14c, live findings from PR #26)

- A product-form guard in the resolve pipeline (ADR-0021 amendment): "chandan itr" no longer resolves to "sandalwood powder". A form word in the query (itr/attar, tel/oil, powder/churan, sabun/soap, agarbatti, pickle/achaar) that the item's names contradict rejects that item at every step, including cached answers and the model's pick; nothing valid left means not found. `CATALOG_VERSION` includes the form list, so cached answers are retired. Seven form cases in `evals/resolve.dev.jsonl`.
- The plan ignores an item id whose names conflict with the customer's words.
- The result screen leads with a summary built from the plan in the screen's language ("2 mein se 1 cheez mili · 1 dukaan · 206 m", the not-found items named, a likely item never called available); the model's own sentence moved into "Ab tak kya hua".
- "X: kisi dukaan mein nahi mili" is said only after the shops had their say and none answered; before that the step reads "pichhle jawabon mein nahi mili" (and ", dukaanon se pooch rahe hain" while asking).

### Added (Day 14b live fixes)

- Vague goals are confirmed once: for "chai banane ka saaman" the agent proposes the usual items and the screen shows them as checkboxes (defaults ticked) with "Kuch aur?" and "Theek hai". `ask_user` gains `multiSelect` and `preselected`; `POST /errands/:id/answer` accepts `selected` (indexes) with optional `text` (ADR-0026). A fourth example, "chai: chai patti, chini, doodh".
- The errand id is in the address (`/app/errand/<id>`), so a reload shows the same errand; `ErrandView` has `lat` and `lng`.
- The result screen: identical plans are shown once (no tabs, no Recommended badge); found items come first and the rest sit under "Nahi mila"; with nothing found there are no zero tiles, only "Abhi kisi dukaan ne jawab nahi diya" and "Dukaanon se phir poochein" (a new errand, same task and place).

### Changed (Day 14b live fixes)

- The server plans every item `resolve_item` placed, loading its stock itself, whatever the agent claimed or left out of `submit_plan`. The prompt no longer allows either/or questions between a common default and a rarer variant.
- A likely item reads "Pichhla jawab: aaj / kal / N din pehle" instead of "Confirmed …".
- At 420 px and below the status chip sits under the errand title, so a long chip cannot squeeze the title to one word per line.
- `CLAUDE.md`: never read `.env` in any form.

### Added (Day 14b)

- Errand screen in the customer app at `/app/errand`, reached from the search screen by "Poora kaam batao": task box with three examples, optional budget, location, "Plan banao"; live progress (state chip, timeline, waiting state with elapsed time, Cancel) refetched on `errand.updated` with a polling fallback; the agent's question as option buttons and a text box; the result as two tabs ("Kam dukaan", "Sabse sasta") with a Recommended badge and a one-line reason, per-item status (Confirmed, Likely, Nahi mila), totals, a map with numbered stops and a line through them, and "Raasta kholo" (Google Maps with every stop); friendly FAILED, EXPIRED and CANCELLED endings with "Dobara koshish karein". Hindi and English.
- `ErrandView.lateAnswers`: shops that said yes after the plan was ready are no longer in `progress`; the screen shows them collapsed under "Baad mein aaye jawab (N)".
- A scripted fake model for end-to-end runs: `LLM_PROVIDER=fake` with `FAKE_LLM_SCENARIO=<file>` plays a JSON list of turns (`modules/ai/scenario.ts`, `e2e/errand-scenario.json`); a full-errand Playwright test saves `e2e/artifacts/errand-result.png`.

### Changed (Day 14b)

- Every "pooch raha hoon" progress line has its count: while the pings are still going out the line waits, and "Poochne ke liye koi dukaan nahi mili" appears if none were sent.

### Fixed (Day 14b)

- The `evals` workflow also starts for a labelled pull request that is opened, reopened or marked ready for review (it ran only on `labeled` and `synchronize`).

### Added (Day 14a)

- Plan optimiser (ADR-0025): `modules/errands/optimiser.ts` builds two plans in code from every offer the errand has seen, `sasta` (least money) and `kam_dukaan` (fewest shops, found exactly), with a route, total price, total distance and savings each; `recommend` picks `kam_dukaan` when it costs at most `ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE` (default 3000) or 10 % more. `errands.plan` stores both plans, `recommended` and `recommendation`; the top level mirrors the recommended plan. Confirmed answers beat learned stock for the same item.
- Plan items show `itemName` (the catalog item confirmed) next to `text`, and `matchedAs: true` with a progress line when the two differ ("Aapne 'diya' kaha tha — dukaan ne 'candle' confirm kiya").
- Items can belong to several categories (migration 013, `items.categories`, primary first): fan-out pings shops of any of them (a stationery shop is pinged for fevicol). `resolve_item` in the agent returns `categories`.
- Catalog v5: 55 everyday items with Hinglish and Devanagari synonyms (puja, cleaning, school, kitchen basics, utensils) and extra categories for 61 existing items; ten dev eval queries.

### Changed (Day 14a)

- The shop, status and price the model names in `submit_plan` are ignored; the plan comes from the optimiser. An item the model marks `not_found` stays out. The prompt no longer asks the model to compare prices. `dhoop` is now its own item (was a synonym of incense sticks).

### Fixed (Day 14a)

- "Samjha: N cheezein" counts every item in the task, including words that could not be resolved, failed lookups and the total in the submitted plan; the same word twice counts once.

### Fixed (evals workflow)

- The `evals` workflow no longer runs on push to `main`; it runs daily at 08:30 UTC on `main`, on the `evals` label and by hand, with a 30-minute timeout and no overlapping runs. The eval runner does a preflight call and stops at once with `QUOTA_EXHAUSTED — rerun after the daily reset` (exit 3) on a daily-quota 429 or three consecutive 429s with a retry hint over 60 s (`modules/ai/quota.ts`; the Gemini adapter keeps `ProviderError.rateLimit`).
- All jobs run on `ubuntu-24.04`; `checkout` v7, `setup-node` v7, `cache` v6, `upload-artifact` v7 (Node 24). Runbook and ADR-0022 note: three Google projects, the schedule, `QUOTA_EXHAUSTED`.

### Added (Day 13)

- Errand agent patience (ADR-0024 amendment): `ask_shops`, `get_request_status` and `ask_user` tools; states `WAITING_FOR_SHOPS`, `NEEDS_INPUT`, `EXPIRED`, `CANCELLED`; wake-up by replies (debounced `request.updated` hook), a timer or the sweeper; maximum wait; `POST /errands/:id/answer` and `POST /errands/:id/cancel`; 15-minute expiry; errand sweeper in the 60 s sweep; the conversation (function calls, thought signatures) persisted in `errand_steps.payload` and rebuilt on resume; `confirmed` plan status backed by a yes in the errand's own requests, with "Confirmed 2 min ago"; progress lines for asking, answers, waiting and questions; `errand.updated` SSE hints; `GET /admin/errands/stats`; migration 012; `realtime.onPublish`.
- Config: `ERRAND_MAX_ASK_SHOPS`, `ERRAND_MAX_QUESTIONS`, `ERRAND_RESUME_AFTER_MS`, `ERRAND_MAX_WAIT_MS`, `ERRAND_ANSWER_TIMEOUT_MS`, `ERRAND_EXPIRY_MS`, `ERRAND_RESUME_DEBOUNCE_MS`.

### Changed (Day 13)

- A run whose lease expired now resumes from the log instead of starting over; `submit_plan` accepts `confirmed`; the agent's system prompt and tool descriptions follow find first, ask shops for thin items, ask the user on a clarification.

### Added

- npm-workspaces monorepo scaffold (`apps/*`, `packages/*`) per the brief's repo structure.
- Root tooling: TypeScript (strict), ESLint, Prettier, Vitest.
- Docs: README, CLAUDE.md, ADRs 0001–0006, PR template, `.env.example`.
- Local stack: `docker-compose.yml` with Postgres 18 + PostGIS 3.6 + pgvector 0.8.7 (`infra/postgres`) and Redis 8; `npm run db:up`, `db:down`, `db:migrate`.
- Database access with `pg` and `node-pg-migrate` (ADR-0007); migrations for extensions and the `shops` table with a GiST index.
- `findShopsWithinRadius` in the shops module, with a Testcontainers integration test.
- GitHub Actions CI: lint, typecheck, unit and integration tests; `.nvmrc` (Node 20).
- API skeleton: Express app with `GET /health` (liveness, git SHA, uptime) and `GET /ready` (Postgres, 503 if down), zod-validated config that fails fast, pino JSON logs with `x-request-id` reuse and echo, graceful shutdown on SIGTERM.
- `infra/api/Dockerfile` (multi-stage, pinned `node:24.21.0-slim`, non-root) and `.dockerignore`.
- `render.yaml` Blueprint: free Docker web service in Singapore, free Key Value, auto-deploy off.
- CD: `deploy` job in CI on main runs Neon migrations, then the Render deploy hook for the tested commit.
- `apps/api/scripts/redis-idle-worker.ts` Redis command-count experiment.
- ADR-0009 (free-tier hosting, supersedes 0002), ADR-0010 (Render Key Value over Upstash), runbook v1.
- Dependencies: express, pino, pino-http, zod, bullmq, ioredis (BullMQ 6 peer), supertest.
- Identity: phone + simulated OTP login (`/auth/otp/request`, `/auth/otp/verify`, `/auth/logout`, `/dev/otp-inbox`), opaque hashed session tokens, roles, `requireAuth`/`requireRole`; `OTP_MODE` config (ADR-0013); OTP limits hold under concurrency; `OTP_MODE` is required in production.
- Shops: `POST /shops`, `GET` and `PATCH /shops/me`; migration 003 (users, otp_codes, sessions, shop owner and category check).
- `packages/shared`: category and role constants, built to `dist` (Dockerfile builds it).
- Catalog: migration 004 (`items`, `item_synonyms` with a trigram index, `shop_stock`, `search_queries`), a 223-item seed catalog with English, Devanagari and Hinglish synonyms, and `npm run seed:catalog` (run by the deploy job after migrations).
- Item resolution: `normaliseQuery` (filler words, quantities), exact synonym then `pg_trgm` match, every query logged (ADR-0014); `TRIGRAM_THRESHOLD` config.
- Search: `GET /search?q=&lat=&lng=&radius_m=` over learned stock, expired stock excluded, freshest bucket then nearest; `findLearnedStock` in the shops module.
- Requests: pure state machine (OPEN, PINGING, ANSWERED, EXPIRED, CLOSED), migration 005 (`requests`, `request_events`), `POST /requests` (idempotent via `Idempotency-Key`), `GET /requests/:id`, `POST /requests/:id/close`; every transition is one guarded UPDATE plus an audit row.
- Expiry (ADR-0015): database deadline, lazy expiry on read, BullMQ delayed job per request and a 60 s sweeper, started in the API process behind `WORKERS_ENABLED` and closed on shutdown. `MIN_STOCK_RESULTS`, `REQUEST_TTL_MINUTES`, `WORKERS_ENABLED` config; `REDIS_URL` now read.
- Fan-out (Day 7a): migration 006 (`pings`, `requests.target_price_paise`); `onRequestPinging` queues a `ping-fanout` job that picks the nearest shops of the item's category (excluding learned-stock shops), applies a Redis `SET NX EX` dedupe (one ping per shop and item per 30 minutes; skipped and logged if Redis is down) and shows the pings.
- Shop side: `GET /shops/me/pings` (item, quantity, target price, distance band only) and `POST /pings/:id/answer` (once; a yes updates learned stock and answers the request in one transaction). Pings left open when a request ends become `NO_REPLY`; a late answer within 24 h still teaches inventory (ADR-0016).
- Price check: `targetPricePaise` on `POST /requests`; `GET /requests/:id` returns live answers plus learned stock, `?sort=distance|price`, and `savingsPaise` below the target.
- Config `MAX_PINGS_PER_REQUEST`, `PING_DEDUPE_MINUTES`; queue calls give up after 2 s when Redis is away instead of waiting forever.
- Shop web app (Day 7b), `apps/web`: Vite + React + TypeScript served by the API under `/app/` with a strict Content-Security-Policy (ADR-0017). Three screens: login (with a Demo mode box that fills the OTP), onboarding (name, 1-2 category tiles, location), and the ping card ("Haan hai" / "Nahi hai", optional price in rupees sent as integer paise, few/plenty chips). Hindi by default with an English toggle, one dictionary file, polling every 5 s. Minimal PWA manifest and icons.
- Fan-out: when the dedupe refuses a shop the next-nearest is asked instead (up to 3x the cap); the sweeper re-adds a lost fan-out job for requests with no pings after 30 s.
- Dependencies for the web app: react, react-dom, vite, @vitejs/plugin-react, @testing-library/react, @testing-library/user-event, jsdom, and the React type packages.
- Errors answer as `{"error":{"code","message"}}`; request logs drop query strings and headers.
- Realtime (Day 8a, ADR-0018): server-sent events. `POST /events/ticket` gives a random one-time ticket (60 s, stored hashed in Redis); `GET /events?ticket=` opens the stream (heartbeat every 20 s, clean removal on close). Events are hints: `request.updated` to the seeker, `ping.created` and `ping.closed` to the shop. Fan-out through Redis pub/sub with a dedicated subscriber connection, published after the transaction commits.
- Shop app: SSE with a new ticket on each reconnect replaces 5-second polling (30-second fallback poll kept), and a small green "live" dot while connected.
- Shop app: the answer buttons show Devanagari large with Latin small below ("हाँ है" / "Haan hai", "नहीं है" / "Nahi hai"); the quantity chips are asked as "कितना है?" with "थोड़ा बचा है" / "काफ़ी है".
- Admin role: `ADMIN_PHONES` (empty by default, fails closed); a listed phone gets role `admin` on login. Admin endpoints answer 404 to everyone else.
- Migration 007: `items.ref_price_paise` (AI-estimated reference price for all 224 catalog items, seed file v2) and `shops.is_simulated`.
- Simulator endpoints (admin only): `POST /admin/sim/shops`, `DELETE /admin/sim/shops`, `GET /admin/sim/events`.
- `apps/simulator`, `npm run simulate`: fake shops (Node built-ins only) that answer real pings through the real answer endpoint over one admin stream. Runbook: "Run the simulator against the live site".
- Config `ADMIN_PHONES`; `.env.example` and `render.yaml` (no value; set by hand).
- Customer app (Day 8b) at `/app/` (the shop app stays at `/app/shop`): login with Demo mode, a search box "क्या चाहिए?" with an optional price seen elsewhere and location (phone, manual, or a labelled "Demo location (Indore)"), a friendly message for an unresolved item, and a results screen with a Leaflet map on OpenStreetMap tiles (green pins for live answers, blue for learned stock, inline SVG, attribution shown), a list with price, saving badge, distance, freshness and a "Raasta" directions link, Sasta / Paas sorting, a status line ("10 dukaanon se poocha · 7 ne haan kaha · 3 ka jawab baaki"), a countdown, live updates over SSE with a 15 s fallback poll and a live dot, and "Ho gaya" to close. ADR-0019.
- API: results carry each shop's `lat` and `lng` (the seeker's own position is never sent to shops); `GET /requests/:id` returns `pingStats {sent, yes, no, pending}`.
- CSP: `img-src` also allows `https://tile.openstreetmap.org`; scripts and styles stay `'self'` only.
- `POST /admin/sim/shops` accepts an optional `categories` list; the simulator has `categories` and `eager` options for tests and demos.
- Playwright end-to-end test (`npm run test:e2e`, `e2e/`) and a separate CI job `e2e`: Postgres, Redis, the API with `ADMIN_PHONES`, five simulated grocery shops, Chromium at 360 px; the screenshot is uploaded as an artifact. Deploy now waits for it.
- Dependencies (approved): `leaflet`, `@types/leaflet`, `@playwright/test`.
- AI query understanding (Day 9, ADR-0020 and ADR-0021): an `LlmProvider` port in `modules/ai` with a Gemini free-tier adapter (`@google/genai`, JSON schema output, temperature 0) and a scripted fake; 8 s timeout, one retry on 429 and 5xx, a circuit breaker per call kind (5 failures, 60 s), and a per-user limit of 30 LLM resolutions per hour (Redis, fails open). AI failure degrades to "unresolved", never to a failed search.
- Migration 008: `ai_calls` (tokens, latency, outcome, request id; no prompt text), `items.embedding vector(768)` with an HNSW cosine index and a source hash, `query_cache`, `suggested_synonyms`, and `search_queries.matched_by` now also `cache`, `embedding`, `llm`.
- Resolution pipeline: cache, exact synonym, trigram, embeddings (`EMBED_THRESHOLD`, `EMBED_MARGIN`), then an LLM shown a shortlist of at most 10 candidates whose answer must name only shortlisted ids; successful answers are cached and LLM matches are queued as suggested synonyms. The query is capped, stripped of control characters and delimited as data. Only query text and catalog names are ever sent.
- API: `422 item_ambiguous` with a question and options from `POST /requests` and `GET /search`; both accept `itemId`. The seeker app shows the question with big option buttons. `GET /admin/ai/stats` (admin only).
- Scripts: `npm run ai:models` (lists the models a key can use), `npm run ai:embed-catalog` (also run by the deploy job when `GEMINI_API_KEY` is set), `npm run eval:resolve` with `evals/resolve.jsonl` (81 labelled queries; reports in `evals/reports/`).
- Config `LLM_PROVIDER` (required in production), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBED_MODEL`, `EMBED_DIM`, `EMBED_THRESHOLD`, `EMBED_MARGIN`. Dependency (approved): `@google/genai`.
- ADR-0011 (product direction: errand agent, shop delivery as stretch), ADR-0012 (npm workspaces monorepo).
- Evals (ADR-0022): `evals/resolve.dev.jsonl` (81 tuning queries), retired `resolve.holdout.jsonl` (v1, 62) and the gating `resolve.holdout.v2.jsonl` (61); `npm run eval:resolve` reports accuracy by category, steps, LLM fallback, tokens, provider p95 and errors per set, retrying failed model calls; the `evals` workflow gates holdout v2 (accuracy ≥ 85 %, injections 100 %, no nonsense resolved, LLM fallback ≤ 40 %, ≤ 3 errors) in a Testcontainers database, on the `evals` label, by hand and on push to `main`; catalog vectors cached in CI; `docs/evals.md`.
- Resolution safety: single-word fuzzy matches must be a typo (edit distance), the query is cut to its first line, and text that reads like an instruction skips the AI steps (`llm_skipped_suspicious`); "light bulb" synonyms; the `glitar` synonym removed.
- Variant defaults as data: `defaultFor` in the catalog seed (pen, bottle, tea, chilli), table `item_defaults`, resolution step `default` after trigram (migration 009).
- `DELETE /admin/ai/cache?q=` removes one cached answer.
- Seeker status line adds the no count ("… 6 ne mana kiya …").

- MCP server (ADR-0023): `apps/mcp-server`, a stdio server over the public API with the user's own seeker token, six tools (`resolve_item`, `find_item_nearby`, `ask_shops`, `get_request_status`, `close_request`, `plan_route`), clear tool errors, and `npm run mcp:build`, `mcp:login` (demo OTP; prints only "logged in") and `mcp:start`. Dependency (approved): `@modelcontextprotocol/sdk`.
- Shared tool registry in `packages/shared/src/tools` (`@kahanmilega/shared/tools`): name, AI-facing description, zod input and output, side-effect and idempotency flags; `toJsonSchema` for the Day 12 agent.
- `POST /route/plan`: shortest order through up to 8 shops by straight-line distance (exact, every order tried).
- `q` is optional on `GET /search` and `POST /requests` when an `itemId` is given.
- README "Use KahanMilega from Claude".
- Errand agent core (ADR-0024): `POST /errands` and `GET /errands/:id` (owner only, with a Hinglish progress list); an own tool-calling loop in `modules/errands` that plans from learned stock only (`resolve_item`, `find_item_nearby`, `plan_route` run in process, plus a terminal `submit_plan`; the user's location is injected by the server) and ends with a checked plan: "likely" only for fresh learned stock, prices and names from the database, a planned route, total and savings against the reference price.
- `LlmProvider.chatWithTools` (Gemini function calling with schemas from the tool registry, scripted turns in the fake adapter, an `errand` row in `ai_calls` per call).
- Migration 010: `errands` (state as text with a CHECK, lease, counters, plan) and `errand_steps` (the step log); guarded state transitions; a per-errand lease so one run works at a time.
- BullMQ queue `errand` (concurrency 1, job id `errand-<id>`); guardrails `ERRAND_MAX_ITEMS`, `ERRAND_MAX_STEPS`, `ERRAND_TOKEN_BUDGET`, `ERRAND_USER_HOURLY_LIMIT`, `ERRAND_TASK_MAX_CHARS`; a task that reads like an instruction is refused (422).
- `npm run errand:smoke` plans real errands against the local database and prints the step logs with tokens.
- `GET /admin/ai/ping` (admin only): a tiny `generateJson` and `chatWithTools` call with the primary and the fallback model, with kind, status and latency per call; runbook section "AI unavailable: troubleshooting".
- `GEMINI_FALLBACK_MODEL`: the attempts after a timeout, 429 or 503 from the primary use a second model (live: `gemini-3.5-flash-lite`); the log and `ai_calls.model` say which model answered.
- `ERRAND_AI_TIMEOUT_MS` (default 30000): errand model calls get their own time limit; resolve calls keep 8 s.

### Fixed

- Nonsense such as "xyzzy plugh" was resolved to a plug top by trigram overlap and then by the model; the trigram and embedding steps now need real words, and the prompt says random letters are not a typo.
- The "Dukaandaar hain? Yahan jaayein" link overlapped the OTP button on the seeker login (an inline link given button padding); checked at 360 px by a browser test.

- A database connection lost while idle (Neon suspending after idle, a Postgres restart: code 57P01) no longer crashes the process: every pool comes from `createPool`, which logs the code and message (never the credentials) and lets the pool reconnect; `withTransaction` survives a connection lost between two queries. Integration tests close the pool, wait for Postgres to see the connections go, then stop the container (this had failed CI on `main` after PR #12).

- Catalog: removed 36 ambiguous generic terms ("clip", "pen", "switch", "powder" and others; listed in the PR) and added a paper clips item; trigram search no longer guesses for a generic word or a near-tie between items; re-seeding deletes terms dropped from the file.

- `/health` reported `sha: unknown` on Render: the Dockerfile default `GIT_SHA=unknown` shadowed `RENDER_GIT_COMMIT`. Blank/`unknown` now count as unset.
- AI failures are logged with `purpose`, `model`, `attempt`, `kind` (timeout, http, network, invalid_output, breaker, other), `status`, `code`, `latencyMs` and a short sanitised `message`; `ai_calls.outcome` stores the same kind (migration 011 replaces `error` and `skipped_breaker`). A timeout is now retried. Circuit breakers are per purpose.

### Changed

- Cached AI answers carry the catalog version and expire (30 days; 1 day for "nothing fits"); a changed seed file retires them all. Migration 009 deletes the cached "xyzzy plugh" and any trigram entry.
- The seeker map refits whenever pins change (a pin turning from learned to live, or moving), so every answered shop is in view.
- Install scripts of `@google/genai`, `cpu-features`, `msgpackr-extract`, `protobufjs` and `ssh2` are denied in `allowScripts` (reasons in the runbook); `npm ci` prints no warning.
- BRIEF: Day 10 is "Evals as a CI gate"; reply parsing moved to Later.

- BRIEF: three-layer summary, Errand flow, errand/order states, agent AI row, agent metrics, 18-day build plan with scope frozen Oct 15, "Later" list.
- Hosting moved from AWS EC2 to free tiers (Render, Neon); BRIEF cloud row and Day 3 updated; ADR-0002 marked superseded.
- Node 24 LTS (`.nvmrc`, CI, `engines`) and Testcontainers 12.x; versions recorded in ADR-0008.
- BRIEF: Errand flow marks what Day 12 built and what Day 13 adds; the Models row now says the errand agent runs on Gemini behind the provider port.
- Runbook: how to run and watch an errand; the free-tier privacy rule now names the shop data the errand agent sends.
