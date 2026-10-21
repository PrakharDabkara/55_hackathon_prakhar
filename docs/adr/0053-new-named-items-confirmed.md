# 0053. New named items are confirmed; agent additions are offered, not pre-ticked (Day 23, PR R)

Status: Accepted · 2026-10-21 · refines ADR-0049. No migration.

## Principle

Nothing reaches a shop without the customer seeing it in a checklist. When the customer named items, the agent's extras are offered unticked. When the customer gave only a goal, the agent's list is pre-ticked for review.

## Decisions

1. **Rule 3, in code (`executor.ts`, `agent.ts`, next to ADR-0049's rules 1 and 2):** an item the customer named that is not an existing catalog item (resolve_item found it new, or not at all) is confirmed through the checklist before any shop is asked. `ask_shops` on it is not run until the customer ticked it; naming it no longer counts as confirming a new item. Catalog items they named still need no question.
2. **The server asks the checklist** when the turn ends with no question and such an item unconfirmed, and `maxQuestions` is not reached (same guard as rule 2). Options: the named items first, ticked (the new one included), then the agent's own items, unticked. At most 8 options. A `submit_plan` in the same turn is held, not run: the model is told the customer must confirm a list first, and plans again after the answer. At the question cap the plan goes through as before.
3. **Rule 2 is unchanged:** for a goal with no named item the agent's proposed list stays pre-ticked. `checklistFor` takes `extrasTicked` (default true); rule 3 passes false.
4. **A new item left unticked stays declined** (ADR-0049 #4): never asked of shops, no second question.
5. **Eval expectation `offeredAny`:** at least one slug of each group must be among the checklist options shown (ticked or not). The scorer matches a slug's words against an option's words; the harness records the options of every question it answers. No production code is involved.
6. **Dev case d18:** the glue-stick | cello-tape | double-sided-tape | scissors group moves from `requiredAny` to `offeredAny`. It was written before ADR-0049, when the agent's extras were pre-ticked and so reached the plan; now they are offered, and the customer decides. Everything else in d18 is unchanged. Other cases are unchanged.

## Consequences

- Fixes d18 (`no_question`, `missing_item`) by construction; no change to resolve, prompts or tool schemas.
- A named catalog item is still asked of shops at once even in the same turn that a new item waits for its checklist.
- The holdout (`evals/errand.holdout.jsonl`) was not opened, read or tuned on.

## Known limitations

- **d18 still fails `not_offered`** (agent dev eval, run 39578262699). The checklist is now asked and every named item is kept, but the agent's extras are only what it resolved that turn, so a helpful extra (glue for a project) may not be offered. Rule 3 does not invent suggestions. d18's expectation is not changed to fit.
- **d22 failed `repeated_call` once** in the same run. It is a goal-only task with nothing named, so rule 3 cannot act on it and nothing in this ADR changes its path. Watch it in later runs.
