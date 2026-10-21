# 0047. Everyday names: the catalog word the customer used (Day 22, PR P)

Status: Accepted · 2026-10-20 · Migration 025.

## Decisions

1. **`requests.matched_alias`** records which catalog synonym matched ("maida" for refined flour). It is read back from `item_synonyms` or `item_defaults` rows (exact synonym, trigram term, default, an item the customer picked), never copied from the customer's text. Embedding and model answers, new items and as-typed searches leave it empty. It is stored only when it differs from the item's own name.
2. **`displayName`** (the alias, first letter up) is exposed on the shop's ping card and order lines (on the allow-list on purpose) and on the customer's request view, next to `typed`, the customer's own `raw_query` (their own data, shown back to them).
3. **Shop slips** show the everyday word large and the English item name small underneath; without an alias, the English name as before.
4. **The customer's parchi** shows their own words exactly as typed, with the matched item small underneath when it is not the same words.
5. **What `name_hi` holds:** seed items hold Devanagari Hindi (0 of 279 equal the English name); customer-made items hold the same Latin text in `name_en` and `name_hi`. An English screen never shows it.

## Consequences

- A shopkeeper who knows "maida" is not asked about "refined flour".
- The privacy line holds: a shop learns a catalog word and nothing the customer typed.
