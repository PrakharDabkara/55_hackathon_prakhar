# 0031. Exact quantity and delivery (Day 16)

Status: Accepted · 2026-10-18 · extends ADR-0016, ADR-0025, ADR-0030. Built in two PRs: C (quantity, delivery offer, optimiser fees, open switch, unknown prices) and D (orders).

## Context

A yes carried a price and a "few / plenty" hint. Customers also want to know how much is on offer, and some shops will bring it home. Delivery is cash on delivery only: no payments.

## Decisions

### Exact quantity (PR C)

1. **Answer.** A yes may carry `quantity: {amount, unit}` next to the price. Units: `kg`, `g`, `l`, `ml`, `piece`, `packet`. Amount and unit come together; the amount is positive (at most 100,000, 3 decimals). Only with a yes. `quantity_hint` stays.
2. **Storage.** `pings.qty_amount`, `qty_unit` and `shop_stock.qty_amount`, `qty_unit` (migration 016, checks keep the pair together).
3. **Shown.** Live answers: "5 kg hai". Below what the customer typed ("2 kg"): "Sirf 1 kg hai" and a "Kam hai (not enough)" badge. The check compares across kg/g and l/ml; kg against a packet is "unknown" and shows no judgement. On the errand plan the item count is compared only with a shop that counted in pieces or packets.
4. **Learned stock keeps it, 3 days.** An exact quantity fades like "a few" (3 days, not 7). It shows as "Pichhli baar: 5 kg", never as a promise, and is **never subtracted**: asking again does not use it up. A yes without a quantity clears the old one.

### Delivery offer (PR C)

5. **The offer.** On a yes the shop can tap "Ghar bhej denge", with an optional fee (0 is free, none is "not told") and an optional time in minutes. Stored on the ping and copied to the shop's learned stock as the last known offer. It is never "confirmed" for a likely offer.
6. **One fee per shop.** However many items come from a shop. No free-above-amount rule (a shop can set fee 0). If a shop's answers named different fees, the largest is used.
7. **Standing offer.** `shops.delivers_default`, `default_fee_paise`, `default_minutes`, set at onboarding and under "Delivery ki settings" on the shop home. A yes starts from it, so a repeat is one tap; Skip is still a plain yes.
8. **Shown** as a chip on result and plan cards: "Ghar bhej denge · ₹30 · 45 min", "· muft", or with neither.

### Pickup or delivery per shop (PR C choice, PR D orders)

9. The customer chooses pickup (default) or delivery per shop on the plan (`POST /errands/:id/modes`, stored in `errands.delivery_modes`). The plans are worked out again from the stored plan on every read (`planWithModes`), so nothing else is written. Only a shop in the plan, and delivery only from a shop that offered it.
10. **PR D (not in PR C):** `delivery_orders` with `REQUESTED → ACCEPTED | DECLINED | EXPIRED (10 min) → OUT_FOR_DELIVERY → DELIVERED`, and `CANCELLED` while REQUESTED or ACCEPTED; decline or expiry falls back to pickup. The address is typed text plus the request's existing location as the pin (no pin dragging). The shop sees the text and a "Map par dekho" link only after ACCEPTED, with a contact line of the customer's first name if given, else "Grahak". **No phone either way**, and the address and phone never reach a model.

### An unknown price is never ₹0 (PR C, found live)

11. A shop that said yes without a price ("Daam nahi bataya") used to add 0 to the total. Now: the total leaves it out and the screen says "+ N cheez ka daam pata nahi"; ranking uses a fair estimate (the median price other shops quoted for that item, this errand's yes and learned stock alike; else the item's typical price; else nothing); `recommend` compares those comparable totals, so a missing price is neither a saving nor a cost.

### Open switch (PR C)

12. "Dukaan khuli hai / aaj band hai": `PUT /shops/me/open`. Closing sets `shops.closed_until` to the end of the day in India; it opens by itself after, or when the owner taps again. A closed shop gets no pings and is left out of learned stock (single searches and plans) while closed.

## Consequences

- Migration 016 only adds. The previous release keeps working against it.
- The optimiser's plan types gain `unknownPriceCount`, `comparablePricePaise` and (after the choice) `deliveryFeePaise`, `unknownFeeCount`, `deliveryShopCount`, `grandTotalPaise`; ADR-0025 is amended. The agent's prompt and tools are unchanged, and no delivery or quantity detail is sent to a model.
- A fee nobody named is ranked with a typical fee (₹30) only to compare plans; the screen says it is not known.

## Alternatives rejected

- **Subtracting a quantity as people buy:** shops do not update it; a wrong "0 left" is worse than a stale "5 kg last time".
- **A fee per item:** shops charge per trip.
- **Free delivery above an amount:** more rules than a shop can set in one tap; fee 0 covers it.
- **Treating a missing price as the cheapest:** it made the least-known shop look best.
