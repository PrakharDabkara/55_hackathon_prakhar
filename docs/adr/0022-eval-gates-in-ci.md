# 0022. Eval gates in CI: a dev set to tune on, a holdout to trust

Status: Accepted · 2026-10-16 (extends ADR-0021)

## Context

ADR-0021 ended with an eval of 81 queries that we had also used to tune thresholds and the prompt: three queries were relabelled after reading the model's answers. A number measured on the data you tuned on is a training score. We also had no automatic check, so a prompt or catalog change could quietly make search worse.

## Decision

1. **Two sets, then a replacement.** `evals/resolve.dev.jsonl` (the original 81) may be tuned on. `evals/resolve.holdout.jsonl` ("v1", 62 queries, written fresh and committed before any run against it) was for judging. Its first runs failed a gate (a nonsense word resolved to an item) and the fixes that followed were informed by it, so **v1 is retired**: kept and reported for history, never gated. `evals/resolve.holdout.v2.jsonl` (61 fresh queries, committed before any run against it) is the gate. The runner's sets are `dev`, `holdout` (v1) and `holdout-v2`; `all` means dev plus holdout-v2. **The holdout is never edited after its results are seen.** A change means a new versioned file (`resolve.holdout.v2.jsonl`) and a note here. If we do tune against it by accident, it stops being a holdout and must be replaced.
2. **One runner, two sets** (`npm run eval:resolve`, `EVAL_SET=dev|holdout|all`). Per set it reports accuracy, accuracy by category (plain, variant, ambiguous, nonsense, injection), answers per step, LLM fallback rate, tokens, p95 latency and errors. JSON goes to `evals/reports/`, a markdown table to `$GITHUB_STEP_SUMMARY`.
3. **Gates, on holdout-v2 only** (`EVAL_GATE=1`): accuracy at least 90 %, injections 100 %, no nonsense query resolved to an item, LLM fallback at most 40 %. The dev set is reported, never gated: it is expected to look good.
4. **CI job `evals`** (`.github/workflows/evals.yml`, environment `evals`, secret `GEMINI_API_KEY`). It runs on pull requests that touch `apps/api/src/modules/ai`, `apps/api/src/modules/catalog` (which holds the catalog seed), the eval runner or `evals/`, and by hand (`workflow_dispatch`). It starts its own Postgres with Testcontainers, seeds and embeds the catalog there, and never touches Neon. If the secret is missing the job fails with a message; it never skips itself.
5. **Free-tier care.** The client retries 429 and 5xx five times with doubling waits (2 s to 32 s); queries that called the model are followed by a 5 s pause (at most 12 model calls a minute; catalog embedding runs at 60 texts a minute); runs are serialised across the repository by a concurrency group. A full run is about 150 queries and well under 300 model requests, far below the daily free limit.

## Resolution fixes made alongside (found by the dev set)

- **Variant defaults are data** (`defaultFor` in the catalog seed, table `item_defaults`, step `default` after trigram and before embeddings). "pen", "bottle", "tea" and "chilli" each name one usual item; the model was inconsistent about asking. Words that mean different things (clip, oil, battery, dal, tape, brush, plug, paper, pin) have no default and stay ambiguous.
- **Nonsense guard.** Trigram resolves only if every query word of 3+ letters resembles something in the catalog and the matched term is at least 60 % as long as the query. Embeddings resolve only if more than half of such words do. The prompt also says a word of random letters makes the whole text a non-product. "xyzzy plugh" had been resolved to a plug top by letter overlap, then cached.
- **Cache hygiene.** Entries carry the catalog version (a hash of the seed file) and an expiry: 30 days for an answer or question, 1 day for "nothing fits". A changed seed retires every entry. Trigram and synonym results are never cached. `DELETE /admin/ai/cache?q=` removes one entry.

## What the first holdout runs taught us

LLM answers vary between identical runs (dev went from 97.5 % to 100 %; one injection was obeyed once and resisted once), so gates need margin and one failure is not a verdict. A catalog misspelling synonym (`glitar`) let "guitar" match glitter one keystroke away, which no edit-distance rule can reject; the synonym was removed. Fixes made after v1: an edit-distance guard for single-word fuzzy matches, first-line cleaning and an instruction-pattern check (ADR-0021), and "light bulb" synonyms.

## Alternatives rejected

- **Gating on the dev set:** it measures memory of what we tuned on.
- **Gating on every pull request:** most PRs cannot change an answer, and each run spends free-tier quota.
- **Mocking the model in CI:** a fake model cannot fail the way the real one does; that is what the gate is for.
- **Running against Neon:** the eval clears the cache and writes search rows; an isolated database is safer and the run is reproducible.
- **A nonsense guard in the LLM step only:** the model is the part we trust least, so the cheap steps must not hand it a plausible-looking wrong shortlist unchallenged.

## Consequences

- A flaky model answer can fail a run. The gates have a margin (the dev run is about 95 to 99 %), and a re-run is one click; if a query flips often it is a real signal to fix the prompt or the catalog.
- A change to the catalog file retires cached answers on the live site, so the next searches may call the model once more.
- Generic words with a default (pen, bottle) no longer ask the seeker a question; that is a product choice the catalog file now owns.
