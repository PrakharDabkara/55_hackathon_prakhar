# 0029. Safety block for new items

Status: Accepted · 2026-10-18 (extends ADR-0028)

## Context

Open catalog means a customer's words can reach real shopkeepers. Shop and user text is data, but a shopkeeper reads it, so a weapon or a drug must never be sent.

## Decision

Code-level, before any shop sees a new item, in `modules/safety`:

1. **Layer 1, a deterministic deny list** (`denyList.ts`): curated whole-word and whole-phrase terms in Latin, Hinglish and Devanagari for weapons, explosives, illegal drugs and counterfeit money, with a short allow list of everyday products that share a word (glue gun, bath bomb, bullet journal, printer cartridge). The longest term wins ("gun powder" is an explosive). It runs first, is free, and no model sees a text it blocks.
2. **Layer 2, the model classifies** each new name as `allowed` (with a category from the fixed list), `blocked` or `nonsense` (`classifyNewItem`, purpose `classify_item`, one call that also decides nonsense versus a real product). The answer is validated in code: a category outside the list is invalid. Only the name is sent; the prompt treats it as data between marks. Blocked and nonsense are never stored.
3. **Fail closed.** If the classifier is unavailable, invalid or rate-limited, nothing is created or sent: `503 item_unavailable`, shown as "Abhi ye cheez dukaanon ko nahi bhej sakte". Blocked is `422 item_blocked` ("Ye cheez hum dukaanon ko nahi bhej sakte").
4. **Limits.** At most 5 new items per errand and 10 per user per 24 hours (`429 new_item_limit`, plain message). Created and blocked attempts count, so blocked spam cannot burn classifier quota; a reused item is free. Table `new_item_attempts` holds the fact and the rule (`weapons`, `classifier`…), never the text.
5. **Logging.** `new_item_blocked` with the layer and rule, `new_item_created` with the category; never the text.
6. **Text that reads like an instruction** (`looksLikeInstruction`) never reaches the classifier or becomes an item.
7. **The errand agent** is told in its prompt and by the tool result (`blocked`, `unavailable`, `limit`) to mark such items not_found and not to retry with other words; the plan lists them with the reason, and the customer sees it. A harmful task creates nothing and asks nobody.

## Consequences

- The deny list is a floor, not a guarantee; the model is the second layer and both fail closed. False positives (an everyday product on the list) are fixed by an `ALLOWED_PHRASES` entry with a test.
- Prescription-only medicines are the model's job in the `medical` category; a stricter rule would need a reviewed list.

## Alternatives rejected

- **Model only:** costs a call for obvious cases and fails open if the prompt is attacked.
- **Deny list only:** cannot see a phrasing it does not list.
- **Failing open when the model is down:** the one time it matters most.

## Amendment 2026-10-18: when unsure, do not create

The first holdout run of the open catalog (PR #29) failed one gate: one nonsense query came back as a new user item, because the classifier called it a real product. Rule written afterwards, against new dev cases only (the holdout text was not read):

- The classifier returns `confidence` (`high` or `low`) and may answer `unsure`. A new item is created only when the model says `allowed` **and** `high`; a missing or low confidence, or `unsure`, is "not found". The prompt now also names person, place, feeling, idea, service, vehicle, phone and property as not products.
- Code checks run first (`catalog/itemSanity.ts`, free): at least one word-like token (a vowel, no five consonants in a row, no keyboard run, no tripled letter) and at least half of the real-length tokens word-like; not mostly repeated characters; not a sentence or question (question and pronoun words, more than 6 words); not a vehicle, phone, laptop, property, service or place itself, unless a word marks an accessory, toy or care product ("iphone charger", "car freshener" pass). Refused text never reaches the model.
- The screen says "Ye cheez samajh nahi aayi — thoda aur batayein".
- 16 new dev nonsense and borderline cases and 2 new-item cases were written for this; the holdouts are untouched.
- The dev miss of the same run was a different bug: the resolve model matched a bead kit to the catalog item "glitter". The resolve prompt now says an item that is only related (similar look, use or word) is not the item, and a kit or set the list lacks is none.
