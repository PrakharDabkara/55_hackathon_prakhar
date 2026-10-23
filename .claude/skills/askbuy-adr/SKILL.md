---
name: askbuy-adr
description: How to write an AskBuy Architecture Decision Record and the daily journey entry. Use when a decision or a rule changes (CLAUDE.md says every new decision gets an ADR), when picking the next ADR number, and when appending the What/How/Why/Learn entry to docs/journey/YYYY-MM-DD.md.
---

# ADRs and the journey

## Numbering

1. `ls docs/adr` and take the highest number plus one, four digits: `docs/adr/0062-short-kebab-title.md`. Check open PRs for the same number too (`gh pr list`, then look at their `docs/adr` files); on a clash, the later PR renumbers.
2. Never renumber or delete an accepted ADR. To change a decision, write a new ADR that says "supersedes ADR-00NN" and add a "Superseded by" line to the old one.
3. Do not change `docs/BRIEF.md` decisions without asking; an ADR that disagrees with the brief is a question for the user first.

## Template

Short: one screen is the target. Match the existing ADRs (see `docs/adr/0061-*.md`).

```markdown
# ADR-00NN: Title in plain words

Status: accepted. One line on what it builds on or replaces (ADR-00MM).

## Context

What was wrong or missing, in a few sentences. Name the incident or the PR that raised it.

## Decision

1. **The first choice, bold.** What we do and where it lives (file paths).
2. **The next.** One numbered item per decision.

## Alternatives rejected

- **Option.** Why not.

## Consequences

- What gets easier, what gets harder, what must now be done (tests, evals, labels, migrations).
```

Status is `accepted`, `proposed` or `superseded`. Say the limits plainly; an honest "this does not cover X" belongs under Consequences.

## Journey entry

`docs/journey/YYYY-MM-DD.md` (today's date; create it if missing, with a `# YYYY-MM-DD` title line if the file is new). Append one section per task or PR:

```markdown
## PR X: short title

- **What:** what changed and which files
- **How:** the approach and key steps (test counts if the PR has tests)
- **Why:** why this approach; the alternative rejected and why
- **Learn:** one concept Prakhar should understand from this task
```

The same block ends the reply to the user (max 12 lines). Append, never rewrite earlier entries.
