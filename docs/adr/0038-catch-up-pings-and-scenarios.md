# 0038. Catch-up pings, and a list of scenarios (Day 17, PR I)

Status: Accepted · 2026-10-19 · the "first yes" part of decision 1 is superseded by ADR-0043 · no new dependency, no migration. Touches the agent prompt only for the checklist rule; no resolve code in this part.

## Decisions

1. **Catch-up pings.** When a shop switches from closed to open (`PUT /shops/me/open`), finishes onboarding (`POST /shops`) or is created by the simulator, the API queues a `catchup` job on the ping fan-out queue. The worker asks the shop about live requests it never saw: state PINGING (no yes yet, which is "enough answers" for a search), more than 2 minutes left, inside the request's radius, an item of one of the shop's categories (the strict kinds: the "nearest of any kind" fallback is for the first fan-out only), fewer than the maximum pings already sent, no fresh learned stock of its own, and at most the 5 newest requests. It uses the same Redis dedupe window and the same announcements as the fan-out (owner event, simulator admin event), and the unique `(request, shop)` ping row makes a duplicate impossible. Without Redis (no workers) nothing is queued and requests simply expire as before.
2. **Closing keeps what is in flight.** Open cards and placed orders can still be answered by a closed shop; it only stops new pings, new orders and its learned stock showing. Rejected: withdrawing open cards on closing, because reopening could not tell which to bring back.
3. **A closed shop is not pushed a new question**; the card waits in its list.
4. **`docs/scenarios.md`** lists the cross-feature interactions and the test of each.
5. **Plan items carry the shop's "thoda/bahut hai"** (`quantityHint`).
6. **Checklist rule in the agent prompt** is general: preselect everything the customer named and the extras necessary for the stated goal, not nice-to-haves. It replaces the earlier "always tick glue and scissors for a school project".

## Consequences

- A shop made after requests are live is asked about them, so tests that make shops mid-file close earlier requests first.
