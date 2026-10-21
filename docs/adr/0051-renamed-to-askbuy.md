# 0051. Renamed KahanMilega → AskBuy (Day 23, PR Q)

Status: Accepted · 2026-10-21 · Finishes what ADR-0050 started (the visible brand).

## Decisions

1. **Everything that cannot hurt a running user, row or deploy is renamed:** workspace packages (`@askbuy/*`), the MCP server name and bin, the errand prompt's brand line, comments, tests, fixtures, error messages, the CI compose project (`askbuy-ci`), the local compose project and image names, and the current docs (BRIEF, README, runbook, CLAUDE.md).
2. **Four things keep the old name on purpose:** the GitHub repo and the Render service/URL; database, role and env var names; browser storage keys (`km-*`) and the push/VAPID setup; the Redis channel `kahanmilega:events` and the runner's `kahanmilega-evals` cache. [docs/naming.md](../naming.md) lists each with its reason.
3. **Local data survives.** The local compose project is now `askbuy`, with the two volumes named explicitly as `kahanmilega_pgdata` and `kahanmilega_redisdata` (what the folder-named project used before).
4. **The MCP client keeps working.** `ASKBUY_API_URL` and `ASKBUY_TOKEN_FILE` are read first; the old `KAHANMILEGA_*` names still work; an old `.kahanmilega-login.json` is moved to `.askbuy-login.json` on first run. Claude clients must re-register the server as `askbuy` (the tool namespace changes).
5. **A guard test** (`evals/naming.test.ts`) fails if the old name appears outside the keep list, the old ADRs, the journey and the changelog.
6. Old ADRs, journey entries and git history are the record and are not edited.

## Consequences

- One later, separate step can rename the repo and the Render service; it needs a planned cutover (new URL, everyone logged out, new VAPID origin).
- `claude mcp add askbuy ...` must be run once on each machine that used the old server name.
