# 0032. Delivery orders (Day 16, PR D)

Status: Accepted · 2026-10-18 · completes ADR-0031 decision 10.

## Context

PR C let a shop say "Ghar bhej denge" and the customer choose delivery on the plan. Nothing was sent to the shop. PR D lets the customer ask. Cash on delivery only: no money moves in the app.

## Decisions

1. **Table.** `delivery_orders` (migration 017): lines, totals and fee are worked out by the server from the shop's own yes (or the plan the customer sees), never from the request body. One open order per customer, shop and source (a partial unique index), so a double tap is one order.
2. **States.** `REQUESTED → ACCEPTED | DECLINED | EXPIRED → OUT_FOR_DELIVERY → DELIVERED`; `CANCELLED` by the customer while REQUESTED or ACCEPTED. A pure table (`orders/stateMachine.ts`), enforced by `UPDATE … WHERE state = from`: of two taps at once one wins, the other is a 409. Repeating the tap that led to the current state is a harmless 200.
3. **Ten minutes.** A REQUESTED order expires after 10 minutes: on the next read by either side, and by the 60 s sweeper (which also publishes). Postgres holds the deadline.
4. **Fallback.** Declined, expired or cancelled puts the plan's shop back on pickup and sends `errand.updated`; the customer's screen says so ("Aap khud jaakar le lein"). On a result card there is no plan to change, only the message.
5. **Address.** Typed text on the order, plus the request's (or errand's) own location copied as the pin; no dragging. The customer may give a first name (first word kept); the shop sees it or "Grahak". **No phone anywhere.** "Saved address" is simply the customer's latest order.
6. **Who sees what.** The shop gets address and map link only in ACCEPTED, OUT_FOR_DELIVERY and DELIVERED (not for declined, expired or cancelled). Views are built field by field in `orders/view.ts`, so a new column never reaches a shop by accident. The address is in no other table, no log line, no realtime event and no model input; tests check each.
7. **Hints.** `order.created` (to the shop's owner; to the admin stream for a simulated shop, with the shop id) and `order.updated` (to both). Ids and a state only.
8. **A withdrawn question says why.** `ping.closed` carries `reason`: `answered` (the shop's own answer), `enough_answers` (another shop's yes ended the request) or `request_ended`. The shop screen shows "Grahak ko jawab mil gaya — shukriya" for 3.5 s when the card in front of it was withdrawn for the second reason, instead of dropping it silently.
9. **Fix.** After a delivery choice the recommendation is worked out again with the configured `ERRAND_FEWER_STOPS_MAX_EXTRA_PAISE` (it used the default).

## Consequences

- The agent's prompt and tools are unchanged; no order or address detail reaches a model (a test reads the errands module for it). No eval label is needed.
- An address stays on its order for good. A retention sweep (for example 30 days after delivery) is a later decision.

## Alternatives rejected

- **Taking the lines and fee from the client:** a customer could name a price.
- **Dragging a pin:** more UI for little gain; the request's location is where the customer asked from.
- **Showing the shop a phone number:** the contact line is enough to hand over the goods, and a number is a way to be pestered.
- **Expiry by a delayed queue job only:** Redis can lose it; the deadline in Postgres, read lazily and swept, cannot.
