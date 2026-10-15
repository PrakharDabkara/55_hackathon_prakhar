# 0014. Item resolution: synonyms + trigram before AI

Status: Accepted · 2026-10-15

## Context

A search must turn text like "aata", "आटा", "gehun ka atta" or "bottel brush" into one catalog item. Every AI step starts with the cheapest path (BRIEF, AI components), and token cost per search is a metric we drive down.

## Decision

`resolveItem` tries, in order:

1. **Normalise** (`normaliseQuery`): lowercase, strip punctuation, keep Devanagari, drop filler words (ka, ki, chahiye, please), pull out a quantity ("5 kilo").
2. **Exact synonym:** the normalised text equals a term in `item_synonyms` (English, Devanagari and Hinglish spellings per item, from a seeded catalog file).
3. **Trigram similarity:** `pg_trgm` finds the closest term at or above `TRIGRAM_THRESHOLD` (default 0.4, floor 0.3 because `%` prefilters at pg_trgm's own default).
4. **Unresolved:** `item: null`. Day 9 adds embeddings (pgvector) and an LLM fallback for exactly these.

Every call writes a `search_queries` row; the unresolved ones become the Day 9 eval set.

Learned stock lives in `shop_stock` (one row per shop and item, price in integer paise, expiry 7 days or 3 if "a few"). Search ranks by freshness bucket (today, last 3 days, older), then distance.

## Alternatives rejected

- **An npm fuzzy library (Fuse.js and similar):** another dependency, and it would load the catalog into the API's memory. `pg_trgm` runs next to the data with a GIN index, so the catalog can grow without the API growing with it.
- **Embeddings or an LLM first:** costs tokens and latency on every search, when a dictionary answers most of them.
- **Per-term similarity in application code:** loses the index and moves data across the wire.

## Consequences

- Quality depends on the synonym list. It was AI-generated and reviewed; the unresolved-query log shows what to add.
- Trigram similarity is weak on short words ("aata" vs "atta" scores about 0.25), so common spellings must be listed as synonyms; fuzzy matching only catches typos on longer words.
- Devanagari trigrams work on a UTF-8 database locale (checked on local `en_US.utf8`); on a database created with the plain `C` locale they would not, and only exact Devanagari synonyms would match. Check Neon's locale if Devanagari typos matter.
- Trigram matching refuses to guess when the answer is not clear-cut: a lone generic word ("tape", "nail") with a second item above the threshold, a lone word that only resembles part of a longer phrase ("band" vs "rubber band"), or a multi-word query whose runner-up item scores within 0.1 of the best. These stay unresolved (and are logged), so Day 9 can ask the user or use the LLM.
- A term belongs to exactly one item, so genuinely ambiguous words ("brush", "tape") are left out of the catalog; the seed check fails on any shared term.
- The catalog file is the source of truth: `npm run seed:catalog` (also run by the deploy job) upserts it, and a term removed from the file is removed from the seeded items.
