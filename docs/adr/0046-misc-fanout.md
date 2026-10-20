# 0046. Uncategorised items go to the nearest open shops (Day 22, PR P)

Status: Accepted · 2026-10-20 · refines ADR-0028 and ADR-0038. Migration 025.

## Decisions

1. **"No category" is a flag, not a null.** `items.category` stays NOT NULL (the shop CHECKs and pickers depend on it). The classifier may answer `other` when no kind of shop fits; the item is stored under `general_store` with `items.uncategorised = true`. Seed items are never uncategorised.
2. **A request copies the flag** as `requests.misc`.
3. **`MISC_FANOUT_MAX = 15`**, one named constant exported from `modules/requests`. A misc request ignores the kind of shop: the fan-out takes the nearest open shops in the normal radius, at most 15. Closed shops are skipped as before.
4. **Catch-up respects the cap.** A shop that opens later is asked about a misc request while fewer than 15 shops have been asked; a categorised request still needs a matching kind.
5. **The three-live-offer rule is unchanged.**
6. **The shop sees a small line** "May not be your usual stock" on a misc ping (`misc` on the ping card, on the allow-list on purpose).

## Consequences

- An item no shop type owns is no longer limited to `general_store` shops or the minimum three; it reaches up to 15 nearby open shops.
- Category-matched items behave as before.
