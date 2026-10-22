# 0013. Opaque session tokens and simulated OTP

Status: Accepted · 2026-10-15. Amended by [ADR-0058](0058-demo-login-allowlist.md): the inbox serves demo phones only, and there is no admin role in the table.

## Context

Day 4 needs login for seekers and shopkeepers with no SMS cost (ADR-0004), and sessions that can be revoked on logout.

## Decision

- **Login:** phone + 6-digit OTP. `OTP_MODE=simulated` is the only mode: no SMS is sent and the code is read at `GET /dev/otp-inbox?phone=...`, which is mounted only in that mode. Config fails fast at startup for any other value (`sms` is not implemented).
- **OTP rules:** valid 5 minutes, single use, dead after 5 wrong attempts, at most 3 requests per phone per 10 minutes. Only `sha256(phone:code)` is the stored proof; the plain code sits in a separate `dev_code` column written only in simulated mode, and is dropped when real SMS arrives.
- **Sessions:** 32 bytes from `crypto.randomBytes`, base64url, returned once as a bearer token. Only its SHA-256 hash is stored. 30-day expiry; logout sets `revoked_at`. A random token needs no salt or slow hash.
- **Roles:** `seeker`, `shop`. A user's role is set on first login; later logins keep it. Admin is the `ADMIN_TOKEN`, not a user (ADR-0058).
- **Phones:** Indian mobiles only, stored as `+91XXXXXXXXXX`. Logs show the last 4 digits only; OTP codes and tokens are never logged.
- **Categories:** eight launch categories in `packages/shared` and a database check on `shops.categories` (1–2 values), kept in step by a test.

## Alternatives rejected

- **JWT:** cannot be revoked without a denylist, which is a session table again, and it needs a library.
- **Plain-text codes in `code_hash`:** defeats the column; the demo inbox gets its own column instead.

## Consequences

- Every authenticated request costs one indexed query (token hash → session → user). Fine at this scale; cache later if load tests ask.
- Simulated mode shows a code only for the numbers in `DEMO_PHONES` (ADR-0058); it was public for every number before. The inbox and dev_code column are removed when real SMS is added.
- The OTP request limit counts and inserts inside one transaction after `pg_advisory_xact_lock(hashtext(phone))`; the attempt limit is one guarded `UPDATE ... WHERE attempts < 5`.
- `OTP_MODE` must be set explicitly in production (fails closed); development and test default to `simulated`.
- A 6-digit hash is guessable offline if the database leaks; the 5-minute life and 5-attempt limit are the real protection.
- Rate limits per phone live in Postgres; per-IP limits on request, verify and the inbox live in Redis (ADR-0058).
