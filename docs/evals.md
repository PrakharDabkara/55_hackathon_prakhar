# Evals

How we measure query understanding (ADR-0021) and keep it from getting worse (ADR-0022).

## Method

Three labelled files in `evals/`, one query per line: `{"q", "kind", "expected"}`. `expected` is a catalog slug, `"ambiguous"` (the seeker should be asked) or `null` (nothing fits).

| File                               | Role                             | Rule                                                                                                                                                                      |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve.dev.jsonl` (131)          | Tuning set                       | We may tune thresholds, prompt and catalog against it. Reported, never gated.                                                                                             |
| `resolve.holdout.jsonl` (62)       | Holdout v1, **retired**          | Its runs informed fixes, so it no longer measures anything unseen. Kept for history.                                                                                      |
| `resolve.list.dev.jsonl` (8 lists) | Shopping-list sorting (ADR-0055) | Dev only: reported, never gated. A line is an item, `ambiguous`, `other` or `refused`. A list that needs more than one model call or one embedding request fails the run. |
| `resolve.holdout.v2.jsonl` (61)    | **The gate**                     | Written fresh and committed before any run against it. **Never edited after its results are seen**; a change means a new versioned file (`v3`).                           |

Why two kinds: a score on the data you tuned on is a training score. The holdout is the only number that says how the system does on queries nobody tuned for.

Each query goes through the whole pipeline (cache, synonym, trigram, default, embedding, LLM). A query is right if it resolves to the expected item, asks a question when `ambiguous` was expected, or resolves to nothing when `null` was expected. Reports group queries into five categories: plain (Hinglish, Devanagari, typos, multi-word, quantities), variant, ambiguous, nonsense and injection. They also give answers per step, LLM fallback rate (queries that reached the model), tokens, p95 model latency and errors.

## Gates (holdout v2, in CI)

| Gate                      | Threshold                  |
| ------------------------- | -------------------------- |
| Accuracy                  | ≥ 85 % (of scored queries) |
| Injection queries         | 100 %                      |
| Nonsense resolved to item | 0                          |
| LLM fallback rate         | ≤ 40 %                     |
| Model errors              | ≤ 3 per set                |

**Why 85 %.** On identical code holdout v2 scored 91.8 % and 88.5 %: the baseline is about 90 % and the model's run-to-run noise is a few points. A gate at 90 % would fail good code at random, so the line sits below the range we saw. We do not use the best of several runs; that would hide the noise instead of leaving room for it.

**Errors are not wrong answers.** A query whose model call fails (429, 5xx, timeout) is retried twice inside the runner. If it still fails it is counted as an error, reported in its own column and left out of accuracy; the errors gate keeps a broken API from passing quietly. p95 latency is the provider call only, not the runner's pacing.

**When it runs.** On a pull request that carries the `evals` label (when the label is added and on every push while it stays), by hand (Actions, Evals, Run workflow), and, once the schedule is back (it is paused until Oct 30, see the runbook), every day at 08:30 UTC on `main` (after the free tier's daily reset), which also seeds the cache pull requests restore from. A run whose daily quota is spent stops at once with `QUOTA_EXHAUSTED — rerun after the daily reset` (see the runbook). PRs that touch `modules/ai`, `modules/catalog`, the catalog seed or `evals/` must carry the label before merge (CLAUDE.md). The job (`.github/workflows/evals.yml`, environment `evals`) fails with a message if `GEMINI_API_KEY` is missing and never skips itself. It uses a throwaway Testcontainers Postgres, never Neon. See the runbook for quotas and pacing.

**LLM results vary between runs.** Identical runs on the dev set scored 97.5 % and 100 %, and one injection was obeyed once and resisted once. The gates leave room for that; a single failure is a prompt to look, not a verdict.

## Run it locally

```sh
# a local Postgres with migrations applied (npm run db:up && npm run db:migrate), a key in .env
LLM_PROVIDER=gemini EVAL_SET=dev npm run eval:resolve            # tuning set
LLM_PROVIDER=gemini EVAL_SET=holdout-v2 EVAL_GATE=1 npm run eval:resolve   # gate, exit 1 if it fails
LLM_PROVIDER=gemini EVAL_DB=testcontainers EVAL_GATE=1 npm run eval:resolve # as CI does (needs Docker)
```

Options: `EVAL_SET=dev|holdout-v2|holdout|list-dev|all` (`all` is dev, holdout-v2 and list-dev), `EVAL_KINDS=variant,typo`, `EVAL_AI_PAUSE_MS` (default 5000), `EVAL_EMBED_CACHE` (saved catalog vectors, default `evals/.cache/embeddings.json`). Reports go to `evals/reports/` (JSON per set and `summary.md`; git-ignored). Use your own eval Google project, never the live site's key; the budget is one full run per day per project.

## Results

CI run on this branch, 2026-10-16: [run 38865827535](https://github.com/PrakharDabkara/55_hackathon_prakhar/actions/runs/38865827535). Model `gemini-3.1-flash-lite`, embeddings `gemini-embedding-001`.

| set                  | queries | accuracy       | plain | variant | ambiguous | nonsense | injection | LLM fallback | tokens | p95 ms | errors |
| -------------------- | ------- | -------------- | ----- | ------- | --------- | -------- | --------- | ------------ | ------ | ------ | ------ |
| dev                  | 81      | 100 % (81/81)  | 56/56 | 3/3     | 9/9       | 8/8      | 5/5       | 23.5 %       | 17382  | 5183   | 0      |
| holdout v2 (gate)    | 61      | 91.8 % (56/61) | 37/37 | 3/4     | 3/7       | 8/8      | 5/5       | 26.2 %       | 13787  | 23100  | 0      |
| holdout v1 (retired) | 62      | 95.2 % (59/62) | 38/38 | 3/4     | 6/7       | 7/8      | 5/5       | 35.5 %       | 19412  | 3320   | 0      |

Holdout v1 is the last result before retirement (its second CI run, which failed the nonsense gate: "guitar" resolved to glitter). It is not comparable with v2: the fixes in between were informed by it.

Answers per step: dev: synonym 45, trigram 6, default 2, embedding 4, LLM 12, unresolved 12. Holdout v2: synonym 21, trigram 15, embedding 4, LLM 8, unresolved 13.

**The same code, run again (a docs-only push re-triggered the workflow, [run 38867197231](https://github.com/PrakharDabkara/55_hackathon_prakhar/actions/runs/38867197231)):** dev 97.5 % (79/81), holdout v2 88.5 % (54/61) with 1 model error and different ambiguous misses ("switch" picked an item, "wrench" came back empty, a Hindi coconut-oil query asked a question). That run restored the embedding cache by prefix (`loaded 224 saved embeddings`, `embedded 2 catalog items`: only the two items whose text changed). Under the original 90 % gate it failed; the spread between the two runs is what set the 85 % line above.

**Both runs under the current gates**, recomputed from their saved JSON reports (no new model calls). The reports predate the runner's retries and per-query error flag, so every errored query is counted as wrong here, which is the strict reading:

| holdout v2 run                                                                                 | accuracy | injection | nonsense resolved | LLM fallback | errors | verdict  |
| ---------------------------------------------------------------------------------------------- | -------- | --------- | ----------------- | ------------ | ------ | -------- |
| [38865827535](https://github.com/PrakharDabkara/55_hackathon_prakhar/actions/runs/38865827535) | 91.8 %   | 100 %     | 0                 | 26.2 %       | 0      | **pass** |
| [38867197231](https://github.com/PrakharDabkara/55_hackathon_prakhar/actions/runs/38867197231) | 88.5 %   | 100 %     | 0                 | 26.2 %       | 1      | **pass** |

The new runner code (retries, error column, errors gate, provider-only latency) has unit tests but has not yet run against the real model; the first labelled PR run or scheduled run will be its first live run. The same holds for the quota stop and the preflight.

**Holdout v2 misses in the passing run (5):** four are single generic words the model answered with one item instead of asking ("dabba" → container set, "stand" → mobile stand, "holder" → bulb holder, "wrench" → adjustable wrench); one is a wrong trigram match ("chilli packet" → chips). Accuracy has only 1.8 points of margin over the gate; ambiguity is where the model is least stable, so watch it before tightening anything else.

## Known issue: single generic words

Single generic words ("dabba", "stand", "holder", "wrench", "switch") often get one item instead of a question, because the model picks the likeliest. **Not fixed yet on purpose:** these words were found by holdout v2, so fixing them now would be tuning on the test. The fix (prompt or data) will be judged on a fresh holdout v3 written without looking at v2's misses.

## Eval labels vs production roles (errand agent)

The labels "primary" and "fallback" in the eval workflow name the model under test, not its production role. In production the errand role (`GEMINI_ERRAND_MODEL`, checked live on `/admin/health/details` after R2) runs `gemini-3.5-flash-lite` first with `gemini-3.1-flash-lite` as fallback. So the agent eval labelled **fallback** (3.5) tested the production **primary**, and the one labelled **primary** (3.1) tested the production **fallback**. Both models scored 92.3 % on the agent dev set. Failover between them is not exercised by an eval (it is off, one model per run); `modelFailover.test.ts` covers it.

## Known misses (dev, not tuned)

- **Agent dev d18** (a school project): fails on both models. The plan has the required items but no unticked extra (glue, tape or scissors) offered. A soft extra the model did not offer. The case is left as written on purpose: changing a case until the model passes would be tuning the eval.
- **Agent dev d14** (slow shops): fails on both models, missing the batteries (the plan had the torch only). It ran in a window of 503s and 30 s timeouts on the tool-side model, so part of it may be provider noise; not tuned.
- **Agent dev d07, d22** (`repeated_call`): failed on 3.5 only (3.1 passed both); d24 (`needless_question`) failed on 3.1 only.

## Reading errand durations

The errand p95 (193.9 s on the 3.5 run, against 64.7 s on the 3.1 run) was not R2 quota waits: the agent model's provider-only p95 was 5.8 s, there were no 429s, and the shortened shop waits keep the 90 s budget out of play. The slow cases were tool-side resolve and classify calls on `gemini-3.1-flash-lite` that hit 503s and 30 s timeouts and were retried (d10: 16 failed calls, 342 s). Judge a run's speed by the provider-only line, and look for 503s and timeouts before blaming the quota.

## Known gaps

- Multi-word trigram matches can be wrong when a query word is shared ("chilli packet" and "chip packet").
- The CI embedding cache is scoped by GitHub to the branch or pull request that saved it, so a run on a different ref starts cold (the full catalog embedding, about 224 requests). The push-to-`main` run after a merge seeds a cache every pull request can restore (by prefix: only items whose text changed are re-embedded).
