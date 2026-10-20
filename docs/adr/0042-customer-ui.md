# ADR-0042: Customer UI

Status: accepted · 2026-10-19

## Context

The shop app got the Parchi design in ADR-0041. The customer app still had one global stylesheet (green, 56 px targets), Hinglish copy and a login wall on open. It needs the same system, in plain English, without changing any LLM prompt, output schema or tool schema.

## Decisions

1. **One design system.** Tokens move from `.shop-app` to `:root` and the old customer variables are deleted with the old stylesheet. Shared primitives (Button, Chip, Field, Switch, BottomSheet, Parchi, Toast, ShopLogo …) move from `shop/ui/` to `apps/web/src/ui/`. Both apps load `ui/baseStyles.ts`.
2. **No login wall.** Find opens for everyone. Pressing "Find nearby" while signed out opens a login sheet; the draft (text, photo, delivery switch, address, location) is kept on the client (`sessionStorage`) and sent right after login. Other customer addresses opened signed out show the same sheet.
3. **The customer's request is a parchi** on the replies screen, with a "N HAVE IT" stamp. Paper appears nowhere else.
4. **Copy.** English everywhere a customer reads, in `i18n/customer/*.ts` (`t.c`), with the Hindi table in parity. Customer push titles, errand progress lines and the plan's remembered-answer text are English; "Grahak" is "Customer".
5. **Strings fed to a model are not touched.** The result `freshness` strings (`liveLabel`, `freshnessLabel`), the errand prompt and tool text, the resolve prompt and the seed catalog's Hinglish `ambiguous` questions stay. The UI renders its own English from timestamps, and the follow-up sheet shows the app's own heading instead of the server's question.
6. **Smallest backend change.** `SeekerOrderView` gains `acceptedAt` and `outForDeliveryAt`. Migration 024 adds `delivery_orders.accepted_at`, set in the same statement that makes an order ACCEPTED (a fresh offer at insert, and the shop's accept). Older orders have no time and show none.
7. **UI fallbacks where the API has nothing:** "Near you" instead of an area name (no reverse geocoding); no claim about reply time; "N shops don't have it" is a count with no names; the errand list is the agent's multi-select question shown as "Your list" with the app's own heading (items can be unticked or added, not edited); the round-trip tile is computed on the client.

## Consequences

- The reply-time promise and per-shop "no" list need backend work if the product wants them.
- Free-form errand questions and the Hinglish follow-up question text come from the model or seed data; they are fixed later together with the evals.
- Tokens are global now: a new `:root` custom property must not clash with a library's.
