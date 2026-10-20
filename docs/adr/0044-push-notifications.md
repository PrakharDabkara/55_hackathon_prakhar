# 0044. Push notifications: named, one per thing, only what needs a tap (Day 21, PR O)

Status: Accepted · 2026-10-20 · refines ADR-0034 (what a push may say) and ADR-0035. No migration, no new dependency, no model input.

## Decisions

1. **Copy names the shop, the item and the price or distance band.** Customer: "{Shop} has {item} · ₹{price}", "{Shop}: your {item} is on the way", "{Shop} cancelled your {item} order". Shop: "New request: {item} · {distance band}", "Customer chose you: {item}". English everywhere; the Hinglish titles are gone.
2. **The payload is `{title, body, tag, renotify, url}`.** `item` is replaced by `body`. The builder still takes only plain words (item, shop name, band, price, counts), cleaned of phone numbers and coordinates, so nothing private can leave (ADR-0034 stands).
3. **A tag per thing, so pushes replace instead of stack.** `req:{requestId}`, `order:{orderId}`, `errand:{errandId}`, `pickup`, and `shop-requests` for a shop's questions. The service worker uses `tag` (older payloads fall back to the link) and `renotify`.
4. **One notification per request for the customer.** The first live yes alerts. The 2nd and 3rd update it quietly (`renotify: false`) to "{N} shops have {item} · from ₹{lowest}".
5. **One notification per shop for new questions.** Each new ping replaces it with "New request: {item} · {band}" (and "and N more" while several wait) and still alerts.
6. **"Order accepted" only follows the shop's accept.** An order born ACCEPTED (a fresh binding offer) sends the customer nothing: they just placed it.
7. **Dropped:** the shop push for the customer's Received (`order_received`), and the unused `order_delivered` kind. Kept: what needs the user to act or wait.

## Consequences

- Chrome sees fewer, specific, replaced notifications instead of repeated generic ones, which is what its spam heuristics look for.
- The notifier reads the shop name, a price and a distance band per push: one small query each, no new table.
- Push text is built from catalog and order data and never reaches a model.
