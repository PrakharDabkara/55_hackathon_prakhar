---
name: askbuy-pr
description: AskBuy's standard pull-request routine, start to finish. Use when starting a PR or task that will be committed, before the first commit, when running the full test suites or the CI-port stack (askbuy-ci, ports 55432/56379), when deciding which docs to update, and when writing the final What/How/Why/Learn report.
---

# AskBuy PR routine

Rules (never push to main, TDD, no `--no-verify`, no `.env`) live in CLAUDE.md and are enforced by hooks. This is the order of work.

## 1. Branch

1. `git fetch origin` and `git branch --show-current`. If it says `main`, or a branch that is not yours, switch first.
2. New work: `git checkout -b <type>/<short-name> origin/main` (type is the Conventional Commit type).
3. Commit locally. Push and open the PR only when the user says so.

## 2. Tests first, in their own commit

1. Write the tests, run them, see them fail for the right reason.
2. Commit them alone: `test: ...`. The implementation is a later commit (`feat:`, `fix:`, ...).
3. Test-only fakes and docs need no eval gate; see the askbuy-evals skill for PRs that do.

## 3. Verify on the CI-port stack

The local dev database stays untouched: use the same compose project, ports and volumes as the CI e2e job (`.github/workflows/ci.yml`).

1. **Wait if CI is using the ports.** On a self-hosted runner the e2e job uses the same ports. Check `gh run list --workflow ci.yml --status in_progress` (the SessionStart line also says if a run is in progress). If one is running, wait for it; do not start a second stack on top.
2. **Set the CI environment in the shell** (these are the throwaway values from `ci.yml`, not secrets):

   ```sh
   export COMPOSE_PROJECT_NAME=askbuy-ci POSTGRES_USER=kahanmilega POSTGRES_PASSWORD=kahanmilega \
     POSTGRES_DB=kahanmilega POSTGRES_PORT=55432 REDIS_PORT=56379 E2E_PORT=53100 \
     DATABASE_URL=postgres://kahanmilega:kahanmilega@localhost:55432/kahanmilega \
     REDIS_URL=redis://localhost:56379 \
     PGDATA_VOLUME=askbuy-ci_pgdata REDISDATA_VOLUME=askbuy-ci_redisdata
   ```

   Variables already in the environment win over `.env`, so the dev database is not reached. Do not open `.env` to check.

3. `docker compose down -v` (clears leftovers; the fixed volume names above keep it off the dev volumes), then `npm run db:up`, `npm run db:migrate`, `npm run seed:catalog`.
4. **Full suites**, in this order:

   ```sh
   npm run lint
   npm run typecheck
   npm run test:unit
   npm run test:integration
   npm run test:e2e
   ```

   Report the counts (passed / skipped / failed) for each. A failure is reported with its output, not worked around. If a rate limit or state blocks a test, stop and tell the user.

5. **Teardown, always**, even after a failure: `docker compose down -v` in the same shell, then check `docker ps` shows no `askbuy-ci` container.

## 4. Docs

- **ADR** when a decision or a rule changes (see askbuy-adr). Not for a plain bug fix.
- **CHANGELOG.md** under `Unreleased`, one entry per PR.
- **Journey**: append the report below to `docs/journey/YYYY-MM-DD.md`.
- Other docs only if they would now be wrong (`docs/ai-tooling.md`, runbook). Keep docs short.

## 5. Report (end of every task)

End the reply with this, max 12 lines, and append the same block to today's journey file:

- **What:** what changed and which files
- **How:** the approach and key steps
- **Why:** why this approach, and which alternative was rejected and why
- **Learn:** one concept Prakhar should understand from this task

Before the block, give the test counts and say what was not run (and why). Do not call something verified that was not.
