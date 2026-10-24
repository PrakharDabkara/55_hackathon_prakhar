# ADR-0066: App round 1: demo-mode login, public demo numbers, general store coverage

Status: accepted. Changes ADR-0058 (a non-demo number now gets an answer at once) and ADR-0054 (the phone on Account starts hidden).

## Context

Two phones, one test. A real number got a code screen it could never finish. Typing 9999999999 was accepted. A shop with the "General store" category was not asked about everyday household, personal care or stationery items.

## Decision

1. **Indian mobiles only, in one place.** `indianMobile()` in `packages/shared/src/phone.ts`: `^[6-9]\d{9}$` after stripping +91, 91 or 0, and ten of the same digit is refused. The API (`normalisePhone`) and both web apps use it, so the rules cannot drift. Demo numbers (9000000xxx) pass.
2. **Demo mode answers at once.** `POST /auth/otp/request` for a number that cannot read its code (not in `DEMO_PHONES`, inbox not open) returns `403 demo_mode` and stores nothing. The web shows "AskBuy is in demo mode. Real numbers can't receive codes yet." with no code screen.
3. **Public demo numbers.** `PUBLIC_DEMO_SHOP_PHONES` and `PUBLIC_DEMO_CUSTOMER_PHONES` (Render, `sync: false`). At startup only numbers also in `DEMO_PHONES` are kept; the rest are dropped with one warning that carries a count, never a number. `GET /auth/demo-numbers?role=shop|seeker` returns `{demo, numbers}` for that role only, no login, under the same per-IP limit as the inbox. The rest of `DEMO_PHONES` is never served.
4. **Tries left.** A wrong code answers `401 invalid_code` with `attemptsLeft` when a live code exists (0 once locked). The web keeps the message on screen until the code is edited.
5. **A general store is also asked about `household_kitchen`, `personal_care` and `stationery` items** (`coveredCategories` in shared). It applies in ping targeting, the catch-up SQL, the demand SQL, the simulated shops' answers and the errand eval harness. Stored categories do not change.
6. **The phone on Account starts hidden** (`+91 ••••• •••••`); an eye button shows the server's partly hidden form. The full number still never leaves the server.
7. **Nothing nearby is said plainly.** No pings sent: the parchi says "No shops asked", the page says why, and offers different words or a 5 km search (the server already allows `radiusM` up to 5000). The remembered-shops section is labelled "Had it recently, not asked this time".

## Alternatives rejected

- **Same 202 for every number (ADR-0058).** Kept strangers from learning which numbers are demo numbers, but sent real users to a dead end.
- **Return the full number behind the eye.** Needs a server change to ADR-0054; not asked for.
- **Copy the general-store rule into the stored categories.** It would change what shops see in Settings and need a migration.

## Consequences

- A caller can now tell whether a number is on `DEMO_PHONES`. The list is 9000000xxx and its codes are readable by anyone who knows the number anyway; real SMS removes this route.
- Agent evals should be rerun at the end of testing: general stores now receive more asks, and the errand eval harness counts them as shops for stationery.
- Prakhar sets `PUBLIC_DEMO_SHOP_PHONES` and `PUBLIC_DEMO_CUSTOMER_PHONES` on Render; unset means no chips, the demo-mode line still shows.
