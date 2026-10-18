# 0025. Plan optimiser: two plans computed in code, recommendation rule

Status: Accepted · 2026-10-17 (Day 14a)

## Context

Day 12 and 13 let the model pick a shop for each item and the server only checked the claim (ADR-0024). That is the wrong split for a shopping plan: choosing among shops is arithmetic over prices and distances, which the model does badly and cannot be tested, while the user wants a real choice ("cheapest" or "fewest shops"). The user also wants a real choice between the cheapest basket and the one with the fewest stops, which a single model-picked shop per item cannot give.

## Decision

1. **The optimiser is a pure function** (`modules/errands/optimiser.ts`): no database, clock or model. Input: the items the customer wants (quantity, reference price) and every offer the errand has seen per item, each with shop, price, distance and status. Offers come from two places: a shop that said yes to one of the errand's own requests (`confirmed`, the price and "Confirmed 2 min ago" from that answer) and fresh unexpired learned stock within 5 km (`likely`).
2. **Which offers count for an item.** One offer per shop (a yes beats learned stock). Confirmed offers only, if the item has any; `likely` only when it has none. Offers with a price only, if any has one. So a cheaper `likely` price never beats a shop that really answered.
3. **Two plans.** `sasta`: every item at its cheapest shop; among shops that tie on price, the fewest shops, then the shortest route. `kam_dukaan`: the fewest shops that still cover every found item, found exactly (take the item with the fewest candidate shops, try each, recurse, drop branches longer than the best; fine for 10 items); among covers of that size each item is bought at its cheapest shop of the set, then lowest total, then shortest route, then the lowest shop ids, so the result never depends on input order. Each plan has its route from the existing planner (`modules/routing`), total price, total distance and savings against reference prices. A plan holds at most 8 stops (the planner's limit): the farthest shops beyond that are dropped and their items become `not_found` with `too_many_shops`.
4. **Recommendation** (`recommend`): `kam_dukaan` if it saves at least one shop and costs at most `ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE` more (default 3000 = ₹30) **or** at most 10 % more than `sasta`; else `sasta`. Either limit is enough, so ₹30 covers small baskets and 10 % covers big ones.
5. **Storage.** `errands.plan` keeps `plans.sasta` and `plans.kam_dukaan`, `recommended` and `recommendation {extraPaise, stopsSaved, reason}`. The top-level `items`, `route`, `totalPricePaise` and `savingsPaise` are a copy of the recommended plan, so a reader that knows one plan keeps working. No migration: `plan` is jsonb.
6. **The model's part.** `submit_plan` still records which items the customer wants and what the model found; an item the model marks `not_found` stays out (it never claims more than it checked). The shop, status and price the model names are ignored: the final plans come from the optimiser, so a made-up shop or price cannot reach the user. An item no shop has stays `not_found` with the old reason (`unknown_item`, `no_shop`, `unknown_shop`, `no_fresh_stock`).
7. **Truthful names.** Every plan item carries `itemName` (the catalog item actually confirmed) next to `text` (the customer's words). `matchedAs: true` when the words are not a name, synonym or default of that item, not a typo of one, and share no whole words with one (`modules/errands/matchedAs.ts`; the terms come from `item_synonyms` and `item_defaults`). Then the progress list says "Aapne 'diya' kaha tha — dukaan ne 'candle' confirm kiya" (for a `likely` item: "dukaan ke paas 'candle' hai", because nobody confirmed it).
8. **Items in more than one kind of shop** (migration 013): `items.categories text[]`, primary first; `items.category` stays and a check keeps `categories[1] = category`. Fan-out pings shops whose categories overlap the item's; `resolve_item` tells the agent all of them.

## Alternatives rejected

- **Let the model weigh the options.** Not unit-testable, and a model's sums are not something to show as a price.
- **One blended score (price + k × shops + distance).** Needs a made-up exchange rate between rupees and stops; two plans with an explicit rule are easier to explain and to change.
- **Greedy set cover for `kam_dukaan`.** Not exact: it can use more shops than needed. The exact search is cheap at 10 items.
- **A table for plans.** Nothing queries inside them yet; jsonb on the errand is enough.
- **Dropping `items.category`.** Other code and the MCP surface read one category; keeping it costs one check.

## Consequences

- A made-up shop id from the model no longer downgrades an item that other shops really have; it is simply ignored. The downgrade reasons remain for items nobody has.
- An item with a stale or unpriced answer can lose to a cheaper likely offer only when no shop confirmed it; `confirmed` always wins.
- The prompt no longer tells the model to compare prices (it said "prefer the cheaper shop"); the eval gate covers the resolve pipeline, not this.
- ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE is the one knob; the 10 % is a constant in `optimiser.ts`.

## Amendment 2026-10-18 (Day 16): unknown prices, delivery fees and per-shop modes (ADR-0031)

- **An offer with no price is never ₹0.** The plan counts it (`unknownPriceCount`), leaves it out of `totalPricePaise`, and ranks it at an estimate: the median price any shop quoted for that item (this errand's yes answers and learned stock), else the item's typical price, else nothing. `comparablePricePaise` is the total with those estimates and is what plans are compared with; `recommend` uses it, so a missing price is neither a saving nor a cost.
- **Delivery.** An offer may carry the shop's delivery (fee, time). The optimiser still plans for pickup; the customer's pickup or delivery choice per shop is applied afterwards by the pure `applyModes`: one fee per shop (the largest if answers differ), a shop on delivery leaves the route (its distance counts as 0, the route is planned again over the rest, `shopCount` is the pickup stops left), an unnamed fee is counted (`unknownFeeCount`) and ranked with a typical ₹30, never added as 0. With a delivery chosen, the recommendation is worked out again over the grand totals with the default extra-cost limit.
