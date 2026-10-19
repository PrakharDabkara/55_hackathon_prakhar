# 0039. Delivery v2 (Day 17, PR J)

Status: Accepted · 2026-10-19 · no new dependency · migration 022. Changes ADR-0031 (delivery offers) and ADR-0032 (orders): the shop no longer ends a delivery.

## Context

Delivery was an extra on a yes: any shop with an offer could be ordered from, a shop had 10 minutes to accept, and the shop itself marked an order delivered. A customer could not say up front that they wanted delivery, a shop could not say "I have it but I cannot bring it", and an order could be left open with several shops.

## Decisions

1. **"Deliver to me" on Find.** `requests.wants_delivery` and `delivery_address_id` (a pointer to the customer's saved address, `ON DELETE SET NULL`). The API refuses a ticked search without one of the customer's own addresses; the database has no check, so forgetting an address later cannot break a row. The address never appears in a `ShopPing` or any shop view before the order is ACCEPTED.
2. **A shop's three answers keep the old mapping.** yes + `delivery{}` is "will deliver", yes alone is "have it, cannot deliver", no is "not available". No new answer values. `ShopPing` gains exactly `wantsDelivery` and `canDeliver`.
3. **`canDeliver` is about distance only.** `shops.delivery_max_km` (null: no limit), set by `PATCH /shops/me { deliveryMaxKm }`. A shop with its standing offer off can still deliver on a single answer; the standing offer only pre-fills the fee and time. `POST /pings/:id/answer` refuses a delivery offer with 409 `cannot_deliver` beyond the limit.
4. **The customer picks ONE shop.** A partial unique index on `request_id` allows one live order (REQUESTED, ACCEPTED, OUT_FOR_DELIVERY) per request; the loser of two taps at once gets 409 "You've already ordered this from another shop". The index does not apply to errand orders, where one plan may use several shops. The other shops that answered get `ping.closed {reason: customer_chose}` and the existing "Grahak ko jawab mil gaya" note.
5. **A fresh offer is binding.** `POST /orders` on the shop's own live yes with delivery, answered at most `OFFER_FRESH_MINUTES` (30) ago, on a request still open and a shop open now, creates the order directly as ACCEPTED and pushes the shop "Grahak ne aapko chuna". Learned stock is never binding. Anything else stays REQUESTED with 10 minutes to accept. A closed shop still takes no new order (409), as in ADR-0038 S3.
6. **The customer ends a delivery.** The shop's `POST /orders/:id/delivered` is removed. The customer's `POST /orders/:id/received` moves OUT_FOR_DELIVERY to DELIVERED. `out_for_delivery_at` and `receive_by` (+ `RECEIVE_WINDOW_HOURS`, 3) are set in the same guarded UPDATE that dispatches. With no Received by then the order becomes NOT_CONFIRMED, a final state, never DELIVERED. As for the other order deadlines, the database column is the truth, a read applies it, and the 60-second sweeper catches the rest; no queue job (orders have none today). The 30-day address clearing includes NOT_CONFIRMED. Orders already out at deploy get `receive_by` three hours from the migration.
7. **Cancel.** One route, `POST /orders/:id/cancel`, decided by who the caller is to this order, not by role (a user can be both a shopkeeper and a customer): the customer cancels REQUESTED or ACCEPTED with an optional reason; the order's shop only ACCEPTED, with a reason (`out_of_stock`, `cannot_deliver_now`, `other` + up to 140 characters) and the customer is pushed; a caller who is both gets 409.
8. **A note.** `delivery_orders.note` (140), set by the customer on `POST /orders`, phone numbers removed with the privacy rule already used for push text (`stripPhoneNumbers`). It is in the shop's order view allow-list.
9. **Errands.** `errands.wants_delivery` and `delivery_address_id` are set from the request body and copied by code onto every request the errand opens. The model sees nothing of them: no prompt, tool schema or status note changed.

## Consequences

- Typing an address on Find keeps it as the customer's saved address (one per customer, deletable under Mere orders); an address typed only on an order is still kept only if they tick the box (ADR-0033).
- When the first yes answers a search, the other pings close (ADR-0038), so two shops usually offer only if they answered at the same moment or the second answers late. The one-shop rule matters in exactly those cases.
- `executor.ts` passes the errand's flag into `createRequest`: CLAUDE.md asks for the `agent-evals` label on a change there, even though no prompt or tool schema changed.

## Alternatives rejected

- A BullMQ delayed job per order for the 3-hour deadline: orders have none today, and a minute's delay on a 3-hour window changes nothing.
- Several saved addresses per customer: the pin and a picker are a bigger step than this PR; the request points at the one address.
- Letting the shop keep a Delivered button: the customer is the one who knows the goods arrived.
