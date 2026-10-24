# ADR-0065: Model failover from observed Gemini errors

Status: accepted. Builds on ADR-0020 (provider seam) and the F1 fixtures (`docs/failure-modes.md`).

## Context

F1 recorded what Google really sends. Three guesses were wrong: a 429 carries `QuotaFailure.violations[].quotaId` and `RetryInfo.retryDelay` (no `retry-after` header); the 30 s pause cap made every retry of a 56 s per-minute limit land inside the window; and a retired model answers 404 while still being listed, so a configured name could fail every call until someone edited the env var.

## Decision

1. **Read the limit from `quotaId`.** `PerDay` is daily; `InputTokens` is a token limit; a 429 with no QuotaFailure is "bare".
2. **Per-minute 429:** wait the full `retryDelay` if the total wait fits the purpose's budget (`waitBudgetMs`: 10 s for search-time calls, 90 s for errand and catalog jobs), else answer this call from the fallback model. No cap on Google's own delay; backoff stays capped at 30 s.
3. **Input-token 429 on a request over `quotaValue`** (estimated at 4 characters a token): never retried and not sent to the fallback (its limit is unknown). A smaller request is an ordinary per-minute 429.
4. **Daily 429:** the model is exhausted until now + `retryDelay`, or the next midnight in America/Los_Angeles; the fallback serves until then. A bare 429 is retried once, then treated as daily.
5. **404 "no longer available" or "not found":** the model is unavailable until restart, one ERROR log, fallback serves.
6. **503, timeout, ECONNRESET:** bounded retry, first retry on the fallback (network drops now included).
7. **State is in memory** (`modules/ai/modelHealth.ts`), per model name, per process. `/admin/health/details` shows per role (chat, errand, embedding) the active model, the primary's state and the reason. Embeddings have no fallback model, so an exhausted or missing embedding model is skipped and callers keep the trigram path.
8. **Both models unavailable:** `AiUnavailableError` as before.
9. **Database and push:** app pools get `connectionTimeoutMillis` 15 s and `statement_timeout` 20 s (Neon wake is a few seconds, up to about 10); seed and embed scripts use `SCRIPT_POOL_OPTIONS` with no statement timeout; push sends stop after 10 s, log, and throw so the queue counts a failure.

## Alternatives rejected

- **Shared state in Redis.** One process serves the API; a restart is a fresh look. Redis down would also lose the state.
- **Retry the same model on a daily limit.** It cannot succeed before the reset.
- **Count tokens with the API before sending.** An extra call on the quota we are protecting.

## Consequences

- A daily-exhausted primary costs one failed call per restart or per reset, not one per request.
- The token estimate is rough: a request near the limit may be retried once more than needed.
- Another process (an eval run, a script) has its own state; it does not learn from the API's.
- Touches the Gemini adapter and client: the `evals` label and an agent dev eval apply.
