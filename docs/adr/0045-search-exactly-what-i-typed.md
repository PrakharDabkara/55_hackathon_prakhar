# 0045. Search exactly what I typed, and Find that is never disabled (Day 22, PR P)

Status: Accepted · 2026-10-20 · builds on ADR-0028 (open catalog), ADR-0029 (safety) and ADR-0036 (understanding). No new dependency.

## Decisions

1. **`POST /requests` takes `asTyped: true`** (with `q`, never with `itemId`). The customer's words become the item: only an exact catalog word is looked up, then the open catalog creates an item from the text. The trigram, default, embedding and LLM steps are skipped, so nothing can swap the words for a nearby item ("pencil HB" stays "pencil HB").
2. **Every check still runs, in code.** Name hygiene (length, characters, links, phone numbers), the deny list, the instruction check, `checkProductName` (nonsense, sentences, out of scope), the new-item limits, the AI rate limiter and the classifier. "As typed" is a way to say what you mean, not a way around safety. Two differences, both because a person confirmed: classifier confidence `medium` is enough, and the only dedupe is the item the same words made before (so a second look is free).
3. **The sheet offers it first.** "Search for exactly what I typed: "{query}"" is the first option of Did you mean. "Something else" now searches that text exactly (it used to run the full resolver again, and a no-match or a fuzzy match left the customer back on Find with a small error).
4. **The sheet stays open on a refusal** and shows why inside it; the "Something else" box clears on reopen, and Enter submits.
5. **Find nearby is never disabled.** With an empty box it focuses the box and says "Type what you need"; with delivery on and no address it focuses the address field. While a search runs it is `aria-disabled` and inert.
6. **Catalog item names read as sentences on the customer's screens** ("Refined flour"); the customer's own words are shown exactly as typed.

## Consequences

- A customer who is not understood is never stuck: they can always search their own words.
- More customer-made items are created (each counts toward the daily limit of ten); an exact catalog word still gives the catalog item.
