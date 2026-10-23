# ADR-0061: Enforce agent rules with hooks

Status: accepted. Turns the rules in `CLAUDE.md` into checks.

## Context

Our safety rules (never read `.env`, never touch the holdout, never push to main, never `--no-verify`)
lived only in prompts. A prompt is a request, not a guarantee: it can be forgotten in a long session,
ignored by a subagent, or lost after a context summary. The incident behind each hook is in
`docs/ai-tooling.md`.

## Decision

1. **Hooks enforce the rules outside the model.** `.claude/settings.json` registers scripts that Claude
   Code runs around tool calls: `guard-secrets` and `guard-git` (PreToolUse, exit 2 blocks), `format`
   (PostToolUse), `notify` (Notification and Stop), `session-status` (SessionStart).
2. **Prompts still state the rules first.** `CLAUDE.md` keeps every rule. The hook is the second layer
   that catches the slip; `permissions.deny` is a third, coarser one.
3. **Plain Node, no dependencies.** Scripts are `.mjs` files that need only Node 24, so they run on any
   machine and in CI without `jq`. Prettier is the repo's own.
4. **Tested by piped JSON.** `.claude/hooks/hooks.test.ts` feeds realistic hook input to each script and
   checks exit codes and messages. No test reads a real `.env` or holdout file.
5. **Honest about limits.** Matching the text of a shell command is best-effort (a determined or
   confused model can build a path at run time). The hooks stop mistakes, not attackers; branch
   protection on GitHub and the pre-push hook stay the hard walls.
6. **Safety hooks fail closed, comfort hooks fail open.** A guard that cannot read its input blocks the
   call; `format`, `notify` and `session-status` never block anything.

## Consequences

- A blocked call shows Claude a reason that says what to do instead, so it can recover without asking.
- A Bash command that merely mentions `holdout` is blocked: a small, accepted false positive.
- Rejected: hooks written with `jq` and shell (not portable, hard to test), and relying on
  `permissions.deny` alone (no "except `.env.example`", no parsing of `git push` targets).
