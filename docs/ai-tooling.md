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
- **Incident:** TODO(Prakhar): name the real incident. The rules it enforces are in `CLAUDE.md`: never
  read `.env`, and the holdout is run by hand only (a model that has read it can tune against it).
- **Limits:** command-string matching is a best-effort layer. `cat $(printf '\056env')`, a script that
  builds the name, or `cd apps/api && cat .e*` get past it. A Bash command that only mentions the word
  "holdout" (a commit message, say) is blocked too; put it in a file. `permissions.deny` in
  `settings.json` is the second layer; it cannot say "except `.env.example`", so it lists the usual names.

## guard-git (PreToolUse: Bash)

- **Does:** blocks `git push` to `main` or `master` (also `HEAD:main`, `+x:refs/heads/main`, force
  pushes, a bare `git push` while on main, `--all`, `--mirror`), any `--no-verify` (and `git commit -n`),
  and `git commit` while the current branch is main. Chains (`a && git push origin main`) and
  `bash -c "..."` are read too. Words inside a quoted commit message do not count.
- **Incident:** TODO(Prakhar): name the real incident. Why it matters: main deploys to production, and
  the pre-push hook can be skipped with `--no-verify`.
- **Limits:** `$(...)`, variables, aliases and `eval` are not expanded. A commit after `git switch` in the
  same command is allowed because the branch is unknown. GitHub branch protection is the real wall.

## format (PostToolUse: Edit, Write)

- **Does:** runs Prettier (the repo's version and config, honouring `.prettierignore`) on the file just
  edited, if Prettier handles the extension. Skips images and the like. Always exits 0; prints one line
  only if Prettier failed (for example a syntax error).
- **Incident:** TODO(Prakhar): name the real incident. `npm run lint` runs `prettier --check`, so an
  unformatted file fails it.
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
