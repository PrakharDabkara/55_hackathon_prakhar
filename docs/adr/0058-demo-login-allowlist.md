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
