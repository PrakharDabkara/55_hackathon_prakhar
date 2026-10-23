## What changed (exact files)

<!-- List every file. After v1.0.0 this must match the CHANGELOG "Post-freeze" entry. -->

## Why (bug + evidence or ref)

<!-- The bug and how you know: a request ref, log line, test, or link to the brief/ADR. -->

## Flows to re-test

<!-- Only the flows this change can affect, on the live site after deploy. -->

## Risk

<!-- What could break, and how to roll back. -->

## Security-reviewer result

<!-- Paste the verdict, or "not needed" and why (no route, migration, worker, prompt or config change). -->

## Evals needed (yes/no and why)

<!-- Resolve pipeline / catalog seed / errand agent touched? Then the label or the agent dev eval result. -->

## Checklist

- [ ] `npm run lint` and `npm test` pass
- [ ] Tests committed before the implementation
- [ ] Modules import only each other's public index
- [ ] No secrets in code; new env vars added to `.env.example`
- [ ] `CHANGELOG.md` updated (`Post-freeze` after v1.0.0)
- [ ] New decision? ADR added in `docs/adr/`
