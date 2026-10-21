# 0049. The errand rule, enforced in code (Day 22, PR P)

Status: Accepted · 2026-10-20 · refines ADR-0024 and ADR-0036. No migration.

## Decisions

1. **What the customer named is worked out in code** (`modules/errands/named.ts`): the task is split on commas, colons, "aur", "and", "+" and "&"; each piece is normalised; a goal ("poha banane ka saaman") names nothing; after "liye" the items of a project follow. "Covers" means the same words, a typo, or one contained in the other.
2. **Nothing named is lost.** A checklist question the agent asks gets every named item it left out, appended and ticked. A plan gets every named item it left out, as not found. Repaired, not retried: no extra model call.
3. **Nothing the agent adds on its own is asked of shops before the customer confirmed it.** `ask_shops` runs only for an item the customer named, or ticked or typed in a checklist (the item's own names and synonyms count, so "sugar" stands for "chini"). Otherwise it is not run and, when the turn has no question, the server asks the checklist itself: the named items first, then what the agent wanted, all ticked, "Which of these do you need?".
4. **A declined item stays declined.** What the customer left unticked is remembered across runs and never asked of shops, and does not trigger another question.
5. **Two new model-facing tool results:** "not run: the customer has not confirmed this item. They will be asked to confirm a list first; do not ask shops until they answer." and "not run: the customer did not choose this item. Do not ask shops about it; leave it out of the plan."

## Consequences

- Fixes the known dev failures: d03 (`no_question`) and d18 (`missing_item`) by construction.
- A task whose items the model rephrases may get one more question than before; the dev cases show whether it over-asks.
- Three dev cases added (d21 to d23); the holdout was not read.
