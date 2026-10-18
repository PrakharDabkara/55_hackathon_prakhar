# 0033. Finding an order again, and what happens to the address (Day 16, PR E)

Status: Accepted · 2026-10-18 · amends ADR-0032 decision 5 and its address consequence.

## Context

A live test of PR D found a gap: after "Ho gaya" on the results screen the customer could not find the order or its status again. ADR-0032 also kept every address on its order for good and called the customer's latest order their "saved address".

## Decisions

1. **Addresses of their own.** `/app/orders` (Mere orders), `/app/order/<id>` (one order, live, works after a reload) and `/app/request/<id>` (a search opened again). The API already serves the app for `/app/*`; the browser's back button follows these addresses.
2. **Mere orders.** `GET /orders` with no query lists the customer's orders (50 at most), open ones first. The home screen has an entry with a badge for orders still moving.
3. **The order page** refetches on `order.updated`, with a plain poll as a fallback. Final states are said plainly (delivered, declined or expired with "pick it up yourself", cancelled). Cancel shows while REQUESTED or ACCEPTED.
4. **Haal ke kaam.** `GET /requests` and `GET /errands` return the customer's last 10 each (id, state, their own words, time); the app merges them. A search opened again has no "you are here": the request view still never carries the customer's own point (an existing test guards this), so the map is drawn around the shops.
5. **Shop side.** `GET /shops/me/orders` returns open orders first, then finished ones (50 in all), not only the last two hours. The shop screen shows "Chal rahe orders" then "Pichhle orders".
6. **Retention.** A sweeper (hourly, in the existing worker) clears `address_text`, `lat` and `lng` of orders 30 days after they reached a final state (`updated_at`, which a final order never moves again). The order stays; the page says the address is removed after 30 days. Migration 018 makes those columns nullable.
7. **Consent.** "Is pate ko yaad rakhein" is unticked by default. Only with the tick does the order write the address and first name to `saved_addresses` (one row per customer, migration 018). `DELETE /orders/saved-address` removes it ("Pata hatayein" on Mere orders). "Saved address" no longer means the latest order. The 30-day sweep does not touch the saved row: it is the customer's own choice, and theirs to delete.

## Consequences

- An address now lives in two places only: its order (until 30 days after the end) and `saved_addresses` (only if ticked). The privacy test that searches every other table still passes with an unticked order.
- No agent, resolve or eval change; no label is needed.
- Orders older than the sweep's first run keep their address until the next hourly pass.

## Alternatives rejected

- **Sending the customer's point back with a request** to centre a reopened search: it breaks the rule that a view never carries it.
- **Deleting the order with its address:** the customer and the shop still need the record of what was ordered.
- **Saving the address by default with an opt-out:** consent should be an act, not a missing click.
