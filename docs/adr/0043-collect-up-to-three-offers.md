# 0043. The customer chooses: up to three offers before the asking stops (Day 20, PR N)

Status: Accepted · 2026-10-20 · supersedes the "first yes closes the other pings" part of ADR-0038 (and the matching notes in ADR-0024 and ADR-0039). No migration, no new dependency.

## Decisions

1. **`MAX_LIVE_OFFERS = 3`**, one named constant exported from `modules/requests`. A product rule, not env config.
2. **The first yes still moves PINGING to ANSWERED** (the page updates, the push goes once), but it no longer withdraws the other pings. They stay open and visible in the shops' lists.
3. **The third live yes withdraws the rest.** `answerPing` already takes the request row lock before touching pings, so yeses are serialised; after the guarded UPDATE it counts `YES AND NOT late` in the same transaction and, at 3, sets the still-open pings to NO_REPLY (note `enough_answers`). A fourth yes at the same moment is therefore stored late (remembered stock, never an offer): the lock makes exactly one of them the third.
4. **Any other ending withdraws them too.** `applyEventIn` withdraws open pings for every event except `SHOP_SAID_YES`, so TIMEOUT or USER_CLOSED on an ANSWERED request does it (note `request_ended`). When the customer places an order or starts a pickup, the requests module's `withdrawPingsForChoice` does it under the same lock (note `customer_chose`, the existing copy).
5. **Expiry keeps the yes.** ANSWERED plus TIMEOUT is still CLOSED; answered pings are untouched and still shown as live.
6. **A yes after the deadline is late** also on an ANSWERED request (the lazy timeout check covers ANSWERED).
7. **Shops' lists and catch-up follow.** A shop's open pings are listed while the request is PINGING or ANSWERED. A shop that opens late is caught up on PINGING and ANSWERED requests with fewer than three live yes (SQL and the recheck under `FOR SHARE`). The first fan-out stays PINGING-only.
8. **Errands are unchanged.** They still wake on the first answer. "Errands wait for more offers" is a follow-up.

## Consequences

- Tests that assumed the first yes closed the rest were rewritten; a shop made mid-file is now also caught up on ANSWERED requests, so those files close ANSWERED requests between tests.
- The customer app shows up to three live replies and "Best price nearby" now has something to compare.
- Cost: a shop may be asked a question the customer has already answered enough; it is told with the usual note, and a late answer still teaches its stock.
