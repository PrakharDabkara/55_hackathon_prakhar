# 0028. Open catalog: the catalog is memory, not a gate

Status: Accepted · 2026-10-18 (extends ADR-0014, ADR-0021, ADR-0025)

## Context

An item the search or the errand agent proposed that was not in the catalog was dropped. A person asking for "bead dazzling kit" got "could not tell which item you mean", although the app's whole idea is to ask the shops.

## Decision

1. **A real product we do not know becomes an item.** When resolve ends with nothing (after every stage, including the product-form guard) and the caller opts in (`openCatalog`), the text is checked (ADR-0029) and, if it is an ordinary product, inserted as an item with `source = 'user'`, `unverified = true`, `created_by` (the user, never sent to a model), `created_at`, a normalised display name (`name_en` and `name_hi` are the same text), and a category the model chose from the fixed list. Nonsense stays "not found" and is never created. `search_queries.matched_by = 'new_item'`.
2. **Name hygiene** (`cleanItemName`): 2 to 60 characters; only Latin letters, digits, spaces and Devanagari (any other character rejects the name); no URL or email; no run of 6 or more digits, also when spaced (a phone number). Filler words and a quantity are dropped, like every query.
3. **Dedupe before creating.** An exact or high-similarity (trigram 0.8) match against the terms of every item (catalog and user) that also passes the form guard reuses that item. The new item gets its normalised name as a synonym, so trigram finds it next time. A cached "nothing fits" is overwritten by the new item.
4. **No embeddings for user items** (saves quota): `embedCatalog` and the deploy's pending count only look at `source = 'catalog'`. Trigram and the exact synonym find them. If this proves too weak, a later batch job can embed them.
5. **Verified by a shop.** The first shop that says yes sets `unverified = false` (in `recordStockYes`) and its answer is learned stock, so the next person gets "Likely" like any item. While unverified the screen says "Nayi cheez: dukaanon se pooch rahe hain".
6. **Where it runs.** `POST /requests` (single search), the errand agent's `resolve_item` tool, and the MCP `resolve_item` through the shared tool registry (`POST /items/resolve`; asking twice adds nothing, so it stays idempotent but is no longer read-only). `GET /search` stays read-only: a GET never creates data.
7. **Categories.** The list is the eight existing ones plus `dairy`, `sabzi_fruit`, `pooja`, `medical`, `bakery_sweets` (the brief's "kirana" is `grocery`, "cosmetics" is `personal_care`). Items and shops use the same list. A shop carries one to three (was two); a shop that picks none is `grocery`, and existing shops with none were set to `grocery` by migration 014.
8. **Who is asked.** `selectPingTargets`: shops within the radius whose categories include the item's category, nearest first. If fewer than 3 shops of that kind are near (counting those that already have the item), the nearest shops of any kind are added up to 3. The ping stays plain text, and the simulator's event carries the item category so it can answer.
9. **Simulator.** The default mix covers all 13 categories (stationery 10 %, hardware 9 %, pooja 5 % and so on, plausible names). An item with no reference price (a user item) is answered yes about 40 % of the time with a price drawn log-uniformly from a range per category.

## Consequences

- The catalog grows from use; `new_item_attempts` and `items.created_by` show who added what. Items nobody confirms stay unverified and cost nothing but a row.
- Migration 014 only adds: old code keeps working against it (migrations run before the deploy, ADR runbook).
- The resolve eval scoring changes (ADR-0022 amendment); the cost of a new unknown text is one extra model call (the classifier).

## Alternatives rejected

- **Creating items on every unresolved search**, including nonsense: pollutes the catalog and the shops' pings.
- **Embedding user items at creation:** quota, for items most of which are asked once.
- **A separate table for user items:** every join (stock, requests, plans) would need two paths.
- **A flag on `GET /search`:** a GET must never create data (caches, prefetchers and retries repeat GETs), so creation has its own POST.
