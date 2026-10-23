# Release and freeze

## v1.0.0

1. `main` is green and no PR is open.
2. Prakhar does the full human test on the live site.
3. Run `scripts/release-check.sh` (below). Every line must say PASS.
4. Tag from an up-to-date `main`: `git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0` (a tag is not a push to main). In `CHANGELOG.md` rename "v1.0.0 (pending human test)" to "v1.0.0 - <date>".

## Pre-tag check

```sh
read -rs ADMIN_TOKEN && export ADMIN_TOKEN   # never on a command line; the script reads no file
scripts/release-check.sh                      # optional base URL as the first argument
```

Read-only. The admin token is sent only to `kahanmilega-api.onrender.com` (https), `localhost` or `127.0.0.1`; any other base URL is refused. It checks: main's last CI run, no open PRs, live `/health`, `/` and `/app/` return 200, `scripts/verify-live-security.sh` passes (it uses this machine's IP budget: run it at most once per 10 minutes, exit 2 means wait), and `/admin/health/details` is reachable with the autopilot on and no failed jobs in 24 h. Exit 0 means ready.

## Freeze (after v1.0.0)

Only hotfixes. No features, refactors or dependency bumps.

1. Branch `hotfix/<slug>` from `main`.
2. The minimal diff, with the failing test first (TDD still applies).
3. Run the `security-reviewer` agent on the diff; paste the result in the PR.
4. CI green.
5. After deploy, re-test on the live site ONLY the affected flow (listed in the PR).
6. Tag `v1.0.x` (next patch number) and push the tag.

Each hotfix adds a "Post-freeze" entry to `CHANGELOG.md`: the version, the exact files changed, and why. Use the PR template; "What changed" and the entry must list the same files. Evals only if the hotfix touches what the eval gates in CLAUDE.md name.

## Branch protection on GitHub

Settings, Branches, Add branch ruleset (or classic rule) for `main`:

- Require a pull request before merging.
- Require status checks to pass (pick the CI jobs; `ci` and `e2e`) and the branch to be up to date.
- Do not allow bypassing, and block force pushes and deletion.

A private repo on a free plan may not offer this (GitHub gates it behind a paid plan or a public repo). If the page shows an upgrade prompt, the local protection is what we have: the `guard-git` hook (`.claude/hooks/guard-git.mjs`) and the tracked pre-push hook (`.githooks/pre-push`, enabled by `npm install`). They stop Claude Code and local pushes only; a push from another machine or the web UI is not stopped, so keep to PRs.
