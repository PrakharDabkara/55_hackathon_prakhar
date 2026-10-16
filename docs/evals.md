# Evals

How we measure query understanding (ADR-0021) and keep it from getting worse (ADR-0022).

## Method

Three labelled files in `evals/`, one query per line: `{"q", "kind", "expected"}`. `expected` is a catalog slug, `"ambiguous"` (the seeker should be asked) or `null` (nothing fits).

| File                            | Role                    | Rule                                                                                                                                            |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve.dev.jsonl` (81)        | Tuning set              | We may tune thresholds, prompt and catalog against it. Reported, never gated.                                                                   |
| `resolve.holdout.jsonl` (62)    | Holdout v1, **retired** | Its runs informed fixes, so it no longer measures anything unseen. Kept for history.                                                            |
| `resolve.holdout.v2.jsonl` (61) | **The gate**            | Written fresh and committed before any run against it. **Never edited after its results are seen**; a change means a new versioned file (`v3`). |

Why two kinds: a score on the data you tuned on is a training score. The holdout is the only number that says how the system does on queries nobody tuned for.

Each query goes through the whole pipeline (cache, synonym, trigram, default, embedding, LLM). A query is right if it resolves to the expected item, asks a question when `ambiguous` was expected, or resolves to nothing when `null` was expected. Reports group queries into five categories: plain (Hinglish, Devanagari, typos, multi-word, quantities), variant, ambiguous, nonsense and injection. They also give answers per step, LLM fallback rate (queries that reached the model), tokens, p95 model latency and errors.

## Gates (holdout v2, in CI)

| Gate                      | Threshold |
| ------------------------- | --------- |
| Accuracy                  | ≥ 90 %    |
| Injection queries         | 100 %     |
| Nonsense resolved to item | 0         |
| LLM fallback rate         | ≤ 40 %    |

The workflow is `.github/workflows/evals.yml` (job `evals`, environment `evals`). It runs on pull requests that touch `apps/api/src/modules/ai`, `apps/api/src/modules/catalog` (the catalog seed), the eval runner or `evals/`, and by hand. It fails with a message if `GEMINI_API_KEY` is missing and never skips itself. It uses a throwaway Testcontainers Postgres, never Neon. See the runbook for quotas and pacing.

**LLM results vary between runs.** Identical runs on the dev set scored 97.5 % and 100 %, and one injection was obeyed once and resisted once. The gates have margin for that, but the margin on accuracy is thin (see below), so a single failure is a prompt to look, not a verdict.

## Run it locally

```sh
# a local Postgres with migrations applied (npm run db:up && npm run db:migrate), a key in .env
LLM_PROVIDER=gemini EVAL_SET=dev npm run eval:resolve            # tuning set
LLM_PROVIDER=gemini EVAL_SET=holdout-v2 EVAL_GATE=1 npm run eval:resolve   # gate, exit 1 if it fails
LLM_PROVIDER=gemini EVAL_DB=testcontainers EVAL_GATE=1 npm run eval:resolve # as CI does (needs Docker)
```

Options: `EVAL_SET=dev|holdout-v2|holdout|all` (`all` is dev plus holdout-v2), `EVAL_KINDS=variant,typo`, `EVAL_AI_PAUSE_MS` (default 5000), `EVAL_EMBED_CACHE` (saved catalog vectors, default `evals/.cache/embeddings.json`). Reports go to `evals/reports/` (JSON per set and `summary.md`; git-ignored). Use your own eval Google project, never the live site's key; the budget is one full run per day per project.

## Results

CI run on this branch, 2026-10-16: [run 38865827535](https://github.com/PrakharDabkara/55_hackathon_prakhar/actions/runs/38865827535). Model `gemini-3.1-flash-lite`, embeddings `gemini-embedding-001`.

| set                  | queries | accuracy       | plain | variant | ambiguous | nonsense | injection | LLM fallback | tokens | p95 ms | errors |
| -------------------- | ------- | -------------- | ----- | ------- | --------- | -------- | --------- | ------------ | ------ | ------ | ------ |
| dev                  | 81      | 100 % (81/81)  | 56/56 | 3/3     | 9/9       | 8/8      | 5/5       | 23.5 %       | 17382  | 5183   | 0      |
| holdout v2 (gate)    | 61      | 91.8 % (56/61) | 37/37 | 3/4     | 3/7       | 8/8      | 5/5       | 26.2 %       | 13787  | 23100  | 0      |
| holdout v1 (retired) | 62      | 95.2 % (59/62) | 38/38 | 3/4     | 6/7       | 7/8      | 5/5       | 35.5 %       | 19412  | 3320   | 0      |

Holdout v1 is the last result before retirement (its second CI run, which failed the nonsense gate: "guitar" resolved to glitter). It is not comparable with v2: the fixes in between were informed by it.

Answers per step: dev: synonym 45, trigram 6, default 2, embedding 4, LLM 12, unresolved 12. Holdout v2: synonym 21, trigram 15, embedding 4, LLM 8, unresolved 13.

**Holdout v2 misses (5):** four are single generic words the model answered with one item instead of asking ("dabba" → container set, "stand" → mobile stand, "holder" → bulb holder, "wrench" → adjustable wrench); one is a wrong trigram match ("chilli packet" → chips). Accuracy has only 1.8 points of margin over the gate; ambiguity is where the model is least stable, so watch it before tightening anything else.

## Known gaps

- Ambiguous generic words are inconsistent: the model often picks the likeliest item. Fixing it belongs in the prompt or in more `defaultFor`-style data, tested on dev and judged on a new holdout.
- Multi-word trigram matches can be wrong when a query word is shared ("chilli packet" and "chip packet").
- The CI embedding cache is scoped by GitHub to the branch or pull request that saved it, so a run on a different ref starts cold (the full catalog embedding, about 224 requests). Seeding it from a manual run on `main` after the merge lets every pull request restore it.
