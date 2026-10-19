# 0036. Saying what we understood, and other follow-ups (Day 17, PR H)

Status: Accepted · 2026-10-19 · no new dependency. Touches resolve and the errand agent: `evals` and `agent-evals` labels needed.

## Context

Live use showed gaps between what a customer typed and what we asked shops. "phool" became a broom, a shop whose answer was called wrong was never asked again, and the errand plan ignored what customers had reported at the shop.

## Decisions

1. **"Kya aapka matlab…?" before any ping.** For a plain search (`POST /requests` with text, no `itemId`, not an errand's own request) only an exact catalog name or synonym goes straight through. Anything else (a typo, a default like "pen", an embedding or model answer, a cached answer) answers 422 `item_confirm` with the understood item and up to two alternatives; nothing is created and no shop is asked. The screen offers "Haan, yahi", the alternatives and "Kuch aur likhein". A new item made from the customer's own words is not asked about (it is their words). A cached answer is never "exact": the cache holds only embedding and model answers; a cached item whose own term equals the text counts as a synonym.
2. **The metric** is three log events with the request id: `understanding_shown` (the question was sent, `kind` confirm or ambiguous), `understanding_confirmed` and `understanding_changed` (the next search says which, in the optional `understanding` field). Count by event name.
3. **A modifier is not the product.** A query whose words are all non-last words of a multi-word term of an item, where that term's last word is a term of the item by itself ("phool" in "phool jhadu", "jhadu" being the broom), does not match that item. It is applied to trigram candidates, embedding candidates (so the model is never shown it), and a cached answer. A last word that means nothing alone ("chai patti") is no product, so "chai" still reaches tea. Root cause of "phool" → broom: the embedding or model step saw the broom as a candidate through its synonym "phool jhadu".
4. **Ambiguous everyday words are data.** `ambiguous` in the catalog file lists words (mirchi, daal, tel and their Devanagari spellings) with the main items and the question; resolve answers them before any other step, with no model call. Catalog version 6.
5. **A wrong answer is hidden, the shop is still asked.** "Wahan nahi tha" already hid the answer, but the shop had been asked inside the 30-minute ping dedupe window, so the next search skipped it. `shop_stock.invalidated_at` (migration 021) records the report; fan-out releases the dedupe claim for a shop that has not been pinged since the report and has not answered since. Once asked, the ordinary window applies again.
6. **The errand plan honours pickup reports.** Invalidated answers were already out of learned stock. A shop with 2 or more reports for an item is chosen for it only if no other shop has it (both plans); plan items carry `customerVerified` and the card shows "Grahak ne confirm kiya".
7. **Ticked items need less proof.** An item the customer ticked in an errand checklist (or typed under it) can become a new item at "medium" classifier confidence; plain search still needs "high". Low, nonsense and blocked are unchanged. The ticked words are kept on the answer note.
8. **Multi-select** when options are not mutually exclusive: the agent prompt and the `ask_user` description say so.
9. **Small UI:** an item without a Devanagari name shows once ("Kesar", not "Kesar Kesar"); order lines carry the customer's own word and the Hindi name (never sent to the shop) and a Hindi screen shows those, not the English catalog name.

## Consequences

- Migration 021 adds one nullable column.
- A search with a typo now takes one more tap. "Haan, yahi" and the alternatives skip resolution (`itemId`).
- Dev evals gain 11 cases (phool, phool jhadu, mirchi, hari mirchi, lal mirch powder, daal, तेल, mentos, harpic, fevicol, maggi); holdouts are untouched ("tel" is in holdout v2, so dev uses "तेल").

## Alternatives rejected

- **Asking for every search:** exact matches are the common case and would only slow people down.
- **A blocklist of words for "phool":** a rule on the shape of the term fixes the whole family ("safai", "toilet" for another product).
- **A new table for ambiguous words:** the catalog file already is the source of defaults; no migration needed.
- **Clearing the Redis key from the API on "Wahan nahi tha":** the API has no Redis; the fan-out already reads the database.
