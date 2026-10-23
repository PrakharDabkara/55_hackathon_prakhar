# ADR-0063: One request ref from the screen to the logs

Status: accepted. Builds on ADR-0060 (what logs may hold) and ADR-0058 (admin routes are 404 without the token).

## Context

A judge's "it broke" had no handle: error bodies carried no id, only some log lines carried one, a failed job did not say which request queued it, and a browser crash reached nobody.

## Decision

1. **A short request ref.** `http/requestId.ts` makes six hex characters (or reuses a safe `X-Request-Id`). `http/requestContext.ts` keeps it in AsyncLocalStorage and the logger's `mixin` adds `requestId` to every line, so modules that log with the root logger carry it too. Error bodies get `error.requestId`; the web client appends "· ref X" to 5xx messages.
2. **Unexpected errors** log class, SQLSTATE and constraint (`describeUnexpected`), never parameters. The serializer is passed to pino-http, which had been replacing it.
3. **Jobs** log through `workers/jobLog.ts`: queue, job name and id, attempt, and `correlationId`, the ref of the request that queued the job (added to job data on fan-out, expiry and errand).
4. **`POST /client-errors`**: strict schema, 2 kb stack, route without query, 10 a minute per IP and per user (the existing route limits), logged at warn. Same origin, so the CSP is unchanged.
5. **`GET /admin/health/details`**: counts and flags only, 404 without the admin token.

## Alternatives rejected

- **UUID refs.** Too long to read out on a call; six hex digits are enough to find one request in a day's logs.
- **A third-party error tracker.** A new dependency and a new place for user data; the brief does not call for one.
- **Putting the ref in a cookie or the session.** A ref names one request, not a person.

## Consequences

- A six-character ref can collide across a long window; search with the time as well.
- There is no daily AI cap in the code, so the details show the day's calls, failures and breaker skips instead of a number against a limit.
- Reports from `/client-errors` are unauthenticated and can be forged; they are only ever logged.
