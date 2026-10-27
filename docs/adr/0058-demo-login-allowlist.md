# ADR-0058: Login in demo mode: allowlist, admin token, trust proxy, fail closed

Status: accepted. Changes ADR-0013 (roles, simulated inbox) and ADR-0018 (admin from config).

## Context

`/dev/otp-inbox` returned the current code for any phone to anyone, so anyone could log in as any account on the live site. The admin was a phone number in `ADMIN_PHONES`, which the same inbox could log in, and that number was printed in the runbook. There was no per-IP limit on sign-in.

## Decision

1. **Demo phones only.** In simulated mode a plain code is stored, and the inbox serves it, only for numbers in `DEMO_PHONES`. Any other number gets the same `202` from request and a hashed code that nothing can read; verify fails as before. The inbox checks the allowlist again when it reads, so a code stored earlier stays unreadable. The migration wipes `dev_code` once.
2. **Admin is a token, not a user.** `ADMIN_TOKEN` (at least 32 characters) as `Authorization: Bearer`, compared with `crypto.timingSafeEqual` on two SHA-256 digests, so a wrong length leaks no timing. No token configured: the admin routes are not mounted (404). Wrong or missing token: the same 404 as an unknown route. `ADMIN_PHONES` is gone. Migration 029 turns existing admin users into seekers, ends their sessions, and the `users.role` check no longer allows `admin`. Login never sets a role from a list.
3. **The admin stream** gets its ticket from `POST /admin/sim/ticket` (admin token), because the admin has no user row.
4. **`OTP_INBOX_OPEN=true` is for tests** (Playwright config and the int-test config): every phone gets a code. Production refuses any value.
5. **Per-IP limits** on a 10-minute window, counted in Redis (shared by instances) with an in-process fallback when Redis errors or is slow: request 10, verify 20, inbox 30. Over the limit: `429` with `Retry-After`. If the limiter itself breaks the request is refused (never fail open). IPv6 clients share a bucket per /64. The per-phone limits stay. `OTP_IP_*_MAX` can lower the limits anywhere and raise them only outside production.
6. **`trust proxy`** is set to one hop (`TRUST_PROXY_HOPS`, default 1) for Render: `req.ip` is the address the proxy appended, and anything a client writes to its left is ignored. Never `true`. Tests prove both a spoofed extra hop and a different real address.
7. **Fails at startup in production** if `DEMO_PHONES` is empty, `OTP_INBOX_OPEN` is set, `ADMIN_PHONES` is still set, or an IP limit is above its default. Messages name the variable, never the value.
8. **The simulator** reads `ADMIN_TOKEN` from the environment (no flag: a secret on a command line lands in shell history) and `--admin-phone` is gone. The e2e run makes a throwaway token per run.

## Alternatives rejected

- **Keep ADMIN_PHONES and block it from the inbox.** Two ways to be an admin, and a phone number is guessable. A secret that no OTP flow can touch is simpler.
- **A login for the admin with a password.** More surface (storage, reset, brute force) for one operator.
- **`express-rate-limit`.** Not in the brief; the store is 60 lines and needs the in-process fallback anyway.
- **Turn the inbox off in production.** The live site is a demo with no SMS; the shop and customer demo logins need it.

## Consequences

- The live demo works only for numbers in `DEMO_PHONES`. Anyone else can request a code but cannot read it, so a stranger cannot log in.
- A leaked `ADMIN_TOKEN` is full admin until rotated (change it on Render and redeploy). It is not in any log.
- The first Render deploy should be checked: if Render or a CDN in front adds more than one hop, `req.ip` is that proxy and all clients share one bucket (set `TRUST_PROXY_HOPS`).
- Real SMS later removes the inbox, `DEMO_PHONES` and `OTP_INBOX_OPEN`; the IP limits and the admin token stay.

## Update 2026-10-27: what the live check showed

- **Order.** On `POST /auth/otp/request` the per-IP limiter runs before the body is validated and before the demo-mode check, and counts every request (demo, non-demo, invalid). The per-phone limit comes last. A test pins this order. A request that gets a 403 has passed the IP limiter.
- **Numbers.** The window is fixed (opened by the first request, never extended): request 10, verify 20, inbox 30 per 10 minutes. Production refuses to start with a higher `OTP_IP_*_MAX`, so the live limit cannot be above 10.
- **Hops.** `TRUST_PROXY_HOPS=2` was tried on Render: `scripts/verify-live-security.sh` check 3 then showed every spoofed request answered 403, because Express took the address the client wrote as `req.ip`. Render appends exactly one address, so **1 is correct** and anything higher lets `X-Forwarded-For` spoofing bypass the limit. It is back at 1.
- **Not explained yet.** With hops at 1 the first live run gave 11 times 403 in check 2, then in check 3 seven 403, three 429, one 403. One fixed-window bucket with limit 10 cannot do that (about 20 requests before the first 429), so the requests were counted in more than one place. Suspected: the Redis store falling back to the per-process memory counter on an error or a 1 s timeout (free Key Value tier). Not confirmed. To see it, a fallback now logs one warn line (`reason` error or timeout, the limiter's name, never an IP or phone; at most one a minute, with the count since the last) and `/admin/health/details` shows `limiter.fallbacksToday`.
- **The script.** Check 3 now sends plain requests until the first 429, then eleven spoofed ones that must all be 429, so it no longer depends on check 2's budget or on the limit's value.

## Update 2026-10-27 (b): Redis ruled out, address families

- **Redis is not the cause.** After the fallback logging shipped, `limiter.fallbacksToday` stayed 0 while the live script still showed split budgets (check 2: eleven 403; check 3: first 429 after about 16 counted requests, then spoofed `403 429 429 429 429 429 429 429 429 403 429`) from a dual-stack laptop.
- **The key already merges address forms (since SEC1).** `ipKey` turns an IPv4-mapped IPv6 address into the IPv4 address and any other IPv6 address into its **/64**, so an IPv6 client rotating privacy addresses inside its /64 keeps one bucket. Every per-IP limiter uses it (`createIpLimiter`, and the sign-in and API limits in `routeLimits.ts`). Tests: IPv4, mapped, same /64 shares, different /64 does not.
- **One real gap, fixed.** Mapped addresses written in hex (`::ffff:cb00:7109`) or full form (`0:0:0:0:0:ffff:...`) all fell into one shared `0:0:0:0` bucket instead of their IPv4 one. Node writes the dotted form, so this was not the live cause; it is now closed and tested.
- **Still open.** If `req.ip` is the same client address for every request, the split cannot come from the key. The remaining suspect is `req.ip` itself: with one trusted hop it is the address the platform's edge appended, and the IPv4 and IPv6 paths (or several edge nodes) may present different addresses. Not confirmed. The script now takes `--ipv4`, `--ipv6` and `--both` (curl `-4`/`-6`, all checks once per family): if one family alone still splits, the cause is not the family. Do not log addresses to find out; compare per-family results first.

## Update 2026-10-28: known issue, the per-IP bucket splits in production

- **Evidence** (live script after #84, laptop on a dual-stack hotspot, `fallbacksToday` 0). `--ipv4`: check 2 eleven 403; check 3 first 429 after 15 plain requests (about 27 counted since check 1), then all eleven spoofed requests 429. `--ipv6`: check 2 eleven 403; check 3 first 429 after 1 plain request, then spoofed `403 429 403 403 429 429 429 429 429 429 429`. Each family splits on its own, so it is not a family split, and not Redis.
- **Trace of `POST /auth/otp/request`, in order.** (1) `rl:api:<key>`, 300 per minute. (2) route rules: none for this path. (3) `rl:request:<key>`, 10 per 10 minutes, fixed window, `<key>` is `ipKey(req.ip)` and nothing else; no phone number or per-request value is in any key (a test sends a different number every time and gets 403, 403, 403, 429). (4) The demo-mode 403 for numbers not in `DEMO_PHONES`. (5) The per-phone limit (3 per 10 minutes, in the database), reached only by numbers that can read a code. The script's fake numbers stop at (4), so every 429 it sees came from (3) (or (1), which one run cannot reach).
- **Conclusion (to be confirmed).** One process, one counter, a key made only of `req.ip`: allowing 27 requests means the key took at least three values. `req.ip` varies from request to request, and differently for each family. That assumes one 10-minute window, one process and the production limit of 10; a run that straddled a window boundary, or a restart or redeploy during it (the free instance restarts), would also allow more. Rule these out first: the run took under 10 minutes and the logs show one process start. Most likely it is the address the platform's edge appends (one trusted hop), and the edge in front of the instance is not one address. **Not proven, and `trust proxy` is not changed**: a higher value lets `X-Forwarded-For` spoofing through (the 2-hop experiment above).
- **Diagnostic (temporary).** `LIMITER_DIAG=on` on Render logs one line `limiter key` per request that reaches a sign-in limiter (`request`, `verify`, `inbox`, `demo-numbers`; filter on `limiter`): `limiter`, `keyHash` (8 hex of an HMAC with a random per-process salt, so it compares within one run and cannot be turned into an address), `family` (`v4`, `v6`, or `none` when there is no usable address) and `xffEntries` (how many addresses `X-Forwarded-For` held; a count, never the values), with the request id. No address is logged. Run the script with `--ipv4`, read the lines of that run: one `keyHash` per request means the key is stable and the cause is elsewhere; several means `req.ip` varies, and `xffEntries` 2 or more means something sits in front of Render's proxy. Turn it off afterwards.
- **Whatever the cause, the live limit is effectively a multiple of 10**, so the "11th request is 429" claim in `docs/limits.md` holds for one stable key only.
