# ADR-0068: App round 3 (final states, hedged AI calls, the eye button)

Status: accepted. Builds on ADR-0038 (catch-up), ADR-0054 (account), ADR-0065 (model failover).

## Context

Prakhar's phone test after round 2 found: "Ask shops now" asked nobody (C-05), a request nobody could answer kept waiting (C-17), "Samsung A4 phone" said "couldn't understand" (C-11), "Fake rose" said "assistant busy" after 15 s (C-16), and the eye button showed a partly hidden number (A-09).

## Decision

1. **Ask shops now on a PINGING request sets `ask_all` and fans out again.** The first fan-out had left out shops that remembered the item; before, the tap changed nothing (`requests/service.ts`).
2. **New event `NOBODY_LEFT` (PINGING → EXPIRED).** It fires when the last asked shop says no with no yes, and when a fan-out asks nobody. Exceptions that stay PINGING: shops left out only because they remembered the item (one tap away), and a shop closed for now inside the radius (ADR-0038 catch-up). The screen shows "None of the shops nearby have it" with next steps, no skeletons, no live dot.
3. **Phones and vehicles are refused on purpose, and say so.** The local rule in `itemSanity.ts` (brand and kind words) stays; the API now answers 422 `item_out_of_scope` instead of `item_unresolved`. The "couldn't understand" text was the bug.
4. **Short Gemini calls use minimal thinking** (`GEMINI_THINKING`, default `minimal`: level MINIMAL on Gemini 3, budget 0 on 2.5 flash; resolve and classify only).
5. **A slow primary is hedged.** After `AI_HEDGE_AFTER_MS` (default 4000, 0 = off) the fallback model is asked too for resolve and classify; first valid answer wins, the other call is aborted. Quota and retired-model rules apply to either side. If both fail, nothing is retried. The 15 s cap and the "assistant busy" message are unchanged. Each hedge is logged with the request id.
6. **The eye reveals the owner's full number (amends ADR-0054 decision 5).** `POST /account/phone/reveal` returns only the caller's own number, `Cache-Control: no-store`, 10 per hour per person, never logged (the logger now also redacts phone numbers in plain text fields). The client asks only when the eye is pressed and forgets the number when hidden, when the page is backgrounded, or when the screen is left.

## Alternatives rejected

- **Letting phones through to the classifier.** The scope rule is a product decision (ADR-0028); not changed without asking.
- **Always hedging at 0 s.** Doubles model cost for every Find.
- **Returning the full number in `GET /account`.** It would be cached, prefetched and loaded without a deliberate tap.

## Consequences

- The reveal limit is also a route rule (shared store), so several instances do not multiply it; the in-process counter is a backstop.
- A closed-shop-only area stays PINGING and shows the zero-shops screen until the deadline.
- The hedge can bill two calls for one Find. Needs a resolve eval and a classify eval (see the PR) before merge.
