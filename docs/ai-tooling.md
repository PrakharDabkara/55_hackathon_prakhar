# AI tooling: Claude Code hooks

The safety rules in `CLAUDE.md` are instructions to a model, and a model can forget one. Hooks are
scripts that Claude Code itself runs around every tool call, outside the model, so a rule that matters
is checked by code. Prompts still state every rule first; hooks are the second layer (ADR-0061).

Config: `.claude/settings.json`. Scripts: `.claude/hooks/*.mjs` (plain Node, no `jq`, no dependencies).
Tests: `.claude/hooks/hooks.test.ts` (run with `npm test`; they pipe JSON into the scripts and never
touch a real `.env` or holdout file).

How it works: before a tool runs, Claude Code pipes the call as JSON to the script's stdin. Exit 2
blocks the call and shows stderr to Claude as the reason; exit 0 lets it through.

## guard-secrets (PreToolUse: Read, Grep, Glob, Edit, Write, Bash)

- **Does:** blocks any `.env` or `.env.*` except `.env.example`, and any path or command that mentions
  `holdout`. File tools are checked by their path fields only; Bash by the command text. The reason
  tells Claude to read `.env.example` or ask you.
- **Incident:** the ".env and holdout are off-limits" rule was repeated in every prompt for two weeks
  and enforced only by the model's goodwill. On Oct 20 an architect-side grep pulled holdout eval case
  lines into a chat (flagged, not used); on Oct 22 a scratch `ci-env.sh` had to be checked by hand for
  `.env` values. The hook turns both rules into a gate.
- **Limits:** command-string matching is a best-effort layer. `cat $(printf '\056env')`, a script that
  builds the name, or `cd apps/api && cat .e*` get past it. A Bash command that only mentions the word
  "holdout" (a commit message, say) is blocked too; put it in a file. `permissions.deny` in
  `settings.json` is the second layer; it cannot say "except `.env.example`", so it lists the usual names.

## guard-git (PreToolUse: Bash)

- **Does:** blocks `git push` to `main` or `master` (also `HEAD:main`, `+x:refs/heads/main`, force
  pushes, a bare `git push` while on main, `--all`, `--mirror`), any `--no-verify` (and `git commit -n`),
  and `git commit` while the current branch is main. Chains (`a && git push origin main`) and
  `bash -c "..."` are read too. Words inside a quoted commit message do not count.
- **Incident:** on Oct 22, `gh pr merge` in the same folder switched the working tree to main while a
  session was mid-task; it avoided committing on main only because it re-checked the branch by hand.
  "Never push to main" and "no `--no-verify`" were otherwise prompt-only.
- **Limits:** `$(...)`, variables, aliases and `eval` are not expanded. A commit after `git switch` in the
  same command is allowed because the branch is unknown. GitHub branch protection is the real wall.

## format (PostToolUse: Edit, Write)

- **Does:** runs Prettier (the repo's version and config, honouring `.prettierignore`) on the file just
  edited, if Prettier handles the extension. Skips images and the like. Always exits 0; prints one line
  only if Prettier failed (for example a syntax error).
- **Incident:** several sessions had to re-run Prettier by hand after edits (for example the errand e2e
  spec fix on Oct 22) before lint passed.
- **Limits:** only files edited through Edit and Write; a file changed by a Bash command is not formatted.

## notify (Notification, Stop)

- **Does:** `notify-send` when Claude Code needs you (permission, waiting for input) or has finished.
  Does nothing if `notify-send` or a desktop session is missing.
- **Incident:** U2 sat idle because its own background check never woke it, and nobody knew.
- **Limits:** a desktop popup only; no phone or sound. It says that the session stopped, not why.

## session-status (SessionStart)

- **Does:** prints three lines: branch and uncommitted file count, open PR count, and whether a GitHub
  Actions run is in progress or queued (runner busy or idle). Each `gh` call is capped at 4.5 s
  (`SESSION_STATUS_TIMEOUT_MS`), and offline prints "unknown".
- **Incident:** a merge switched the branch under a running session.
- **Limits:** a snapshot at the start only. It does not notice a branch change later; guard-git blocks
  the worst outcome (a commit on main), not a commit on the wrong feature branch.

# AI tooling: subagents

A subagent is a second Claude that the main session starts for one job. It gets its own empty context,
its own prompt and only the tools its file allows; it does the work and hands back one report. The
main session never sees its file reads or command output, only the report. Definitions live in
`.claude/agents/*.md` and are loaded when a session starts (a new file needs a restart).

## flake-hunter (`.claude/agents/flake-hunter.md`)

- **Does:** takes ONE flaky test, runs it many times alone and under CPU load, classifies the cause
  (ordering, timing window, shared state, test pollution, real product bug) and returns root cause,
  failure rate and a minimal proposed diff.
- **Why it exists:** two integration tests failed under CI load and blocked the SEC3 deploy twice:
  `notifier.int.test.ts` ("and 1 more" on the first push) and `simulate.int.test.ts` ("expected 3 to be
  > = 4"). Each needs a repeat-and-load loop that fills a context with test output.
- **Why read-only:** tools are Bash, Read, Grep and Glob; it cannot edit. A diagnosis should not change
  the code it measures, and the main session reviews every proposal before it lands, so a flake that is
  really a product bug is not "fixed" by weakening a test. The secrets hook still applies to it.
- **Two in parallel:** the two tests share no code, so each got its own hunter at once. The loops
  (dozens of vitest runs each) stayed out of the main context, which received two short reports; the
  wall clock was the slower hunter (about 10 minutes), not the sum.
- **Limits:** neither hunter could reproduce the failure on a 14-core machine, even with 12 busy loops.
  Both diagnoses come from reading the code, and the CI message fits exactly what the race produces.
  A subagent starts cold, so it needs the evidence in its prompt.

# AI tooling: skills

A skill is a folder with a `SKILL.md`: a procedure Claude reads only when it is needed. Skills live in
`.claude/skills/<name>/` and are loaded when a session starts, so **a new or renamed skill appears
only in a new session** (start one, or `/clear`, after adding it).

**Progressive disclosure.** Three levels, each paid for only when reached. (1) At session start only
each skill's `name` and `description` are in context, about a line each. (2) When the task matches a
description, or a file matches the skill's `paths`, the body of `SKILL.md` is loaded. (3) Files the
body points to (scripts, templates) are read or run only when the steps get there. `CLAUDE.md`, by
contrast, is loaded in full into every session, so it should hold only the facts and rules that apply
everywhere. The description is the trigger: it must say when to use the skill, in the words a task
uses. Tests: `.claude/skills/skills.test.ts` (frontmatter) and `run-evals.test.ts` (the script, with a
stubbed `gh`).

Skills explain a procedure; they do not enforce. The secrets, hold-out and git rules stay in
`CLAUDE.md` and in the hooks above.

## askbuy-pr

- **Does:** the PR routine in order: branch check, tests in their own commit, the CI-port stack
  (`askbuy-ci`, ports 55432/56379, wait if a CI e2e job is running, teardown), the full suites, docs, and
  the What/How/Why/Learn report.
- **Why it exists:** the same paragraph was pasted into every prompt, and `CLAUDE.md` carried the stack
  details for every session, including sessions that never run a test.

## askbuy-evals (with `run-evals.sh`)

- **Does:** runs one or more evals through GitHub Actions, strictly one after another. The script takes
  the run id from the URL `gh workflow run` prints, never "the latest run", polls that run until it is
  completed, prints the conclusion and stops the list at the first failure.
- **Incident, cancelled run (Oct 22):** a helper script started the resolve eval, then `gh run watch`
  returned early with an empty conclusion, so the script dispatched the agent eval on the same ref. The
  workflow's concurrency group (one active run per ref) cancelled the still-running resolve run
  (39740176924). Lesson: wait on the specific run id until `status` is `completed`.
- **Incident, empty-id loop (Oct 22):** a script found the new run with `gh run list --limit 1` 20 s after
  dispatch; GitHub had not listed it yet, the id came back empty and the polling loop spun on "run or job
  ID required" until stopped. Lesson: take the id from gh's printed URL and hard-stop if it is missing.
- **Rules it carries:** never read or print the hold-out set (the script refuses it), quota resets at
  12:30 PM IST (07:00 UTC; 13:30 IST after early November), `QUOTA_EXHAUSTED` means wait and not retry, and the budget is one full resolve run per day
  per eval project because CI, the schedule and local runs share it.
- **Limits:** it needs `gh` signed in with permission to run workflows. It cannot tell a quota stop from
  any other failure except by the run's conclusion; read the step summary.

## askbuy-ui

- **Does:** the Parchi design rules (tokens only, Mukta for UI and Kalam only on a parchi, paper-locked
  colours, 44 to 48 px targets, focus at least 3:1, 360 px first, light/dark/`data-theme`, no browser
  dialogs, parchi only on request cards and packing slips).
- **Auto-load:** `paths: apps/web/**`, so it comes into context when web files are touched and not for
  API or docs work. It was the longest block in `CLAUDE.md`.

## askbuy-adr

- **Does:** the ADR template, the numbering rule (highest plus one, check open PRs, never renumber) and
  the journey entry format.
- **Why it exists:** the ADR format and the journey file were re-explained in prompts.
