---
name: askbuy-evals
description: How to run AskBuy's model evals (resolve and errand agent) safely through GitHub Actions. Use when a PR touches the resolve pipeline, the Gemini adapter, resolve prompts, the catalog seed, the errand agent or evals/, when asked to run an eval or check the eval gate, or when a run reports QUOTA_EXHAUSTED. Bundles run-evals.sh, which runs one or more evals strictly one after another.
---

# Running evals

Which PRs need which eval is a CLAUDE.md rule. This is how to run them without wasting quota.

## Use the script

```sh
.claude/skills/askbuy-evals/run-evals.sh resolve              # resolve eval gate
.claude/skills/askbuy-evals/run-evals.sh agent                # agent dev set, fallback model
.claude/skills/askbuy-evals/run-evals.sh resolve agent        # both, one after the other
```

A spec is `suite[:set[:model]]`. The agent defaults are the ones CLAUDE.md asks for (`set=dev`, `model=fallback`; the `agent-evals` label would run the wrong model). Set `EVAL_REF=<branch>` to run on a branch other than the default.

What it does, and why:

1. Dispatches **one** workflow run with `gh workflow run evals.yml ...`.
2. Takes the **run id from the URL gh prints** (`.../actions/runs/<id>`). If there is no id it stops with exit 4. It never falls back to "the latest run".
3. Polls `gh run view <id>` until `status` is `completed`, then prints the conclusion.
4. Only then starts the next eval. It stops the list at the first run that did not succeed.

Exit codes: 0 all succeeded, 1 a run failed, 2 bad usage or a refused set, 3 dispatch failed, 4 no run id, 5 gave up waiting (`MAX_WAIT_SECS`, default 3600).

## Rules

- **Never read, print or open the hold-out set or its results**, and never pass it to the script (it refuses). The user runs it by hand; the runbook has the steps. Dev-set content is fine to read.
- **Never use "latest run"** (`gh run list -L 1`, `--latest`) to find a run. Another run, or none, comes back.
- **Never run two evals at once.** They share one Gemini project quota and one runner, and the workflow cancels an older run on the same ref when a newer one starts (`concurrency` in `evals.yml`).
- **Quota resets at midnight US Pacific.** While Pacific is on daylight time that is 07:00 UTC = 12:30 PM IST. After early November (daylight time ends) it moves to 08:00 UTC = 13:30 IST. `QUOTA_EXHAUSTED — rerun after the daily reset` means wait until then. **Do not retry**, do not change code to "fix" it, and do not run a local `eval:resolve` meanwhile; it spends the same project's quota.
- **The budget is one full resolve run per day per eval project** (about 224 + 143 embedding requests and 60 generation requests against 1,000 and 500 a day). It exists because the free tier is shared by CI, the daily schedule and any local run; a run that overspends leaves the 08:30 UTC schedule and the next PR with nothing. So run only what the PR rule asks, once, and don't re-run to see a nicer number: results vary a few points between identical runs, and the gates already leave room for it.
- Paste the result (run URL and conclusion) in the PR. The agent dev eval result is required before merge for errand-agent PRs.

## Incidents behind these rules (Oct 22)

- **The cancelled resolve run.** A helper script started the resolve eval, then `gh run watch` returned early with an empty conclusion, so the script immediately dispatched the agent eval on the same ref. The evals workflow's concurrency group (one active run per ref) cancelled the still-running resolve run (39740176924). Lesson: wait on the specific run id until `status` is `completed` before dispatching the next.
- **The empty-id loop.** A script looked up the new run with `gh run list --limit 1` 20 s after dispatch. GitHub had not listed it yet, so the id came back empty and the polling loop spun on "run or job ID required" until it was stopped. Lesson: take the id from gh's printed URL and hard-stop if it is missing.
