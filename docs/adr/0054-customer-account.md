# 0054. Customer account: log out revokes the session, delete is soft, the look is per device (PR S)

Status: Accepted · 2026-10-21 · migration `026_account_deletion.sql`.

## Decisions

1. **Log out ends the login on the server.** `POST /account/logout` revokes the session (the old token answers 401) and, in the same call, removes the push subscription of the browser named in `pushEndpoint`. One call, because the token dies there and the client could not unsubscribe afterwards. If the server cannot be reached, the device still forgets the token. The old `POST /auth/logout` stays for the shop app.
2. **Delete is soft.** `DELETE /account` (seekers only) runs in one transaction: lock the user row, refuse with 409 `open_order` ("Finish or cancel your open order first.") while an order is REQUESTED, ACCEPTED or OUT_FOR_DELIVERY, a request is OPEN, PINGING or ANSWERED and not expired, or an errand is PLANNING, WAITING_FOR_SHOPS or NEEDS_INPUT. Otherwise delete the push subscriptions, the saved address and all sessions; null the address, pin and first name on the customer's own past orders; set `users.phone = NULL` and `deleted_at`. Requests, orders and errands stay, pointing at the anonymised user, so shops keep their records without a number. REQUESTED is included (the brief named two states) because an accept after the delete would leave an accepted order for nobody.
3. **The same phone registers again as a new account.** `users.phone` loses NOT NULL; its UNIQUE ignores NULLs and the format CHECK passes for NULL. Login inserts a new row.
4. **Delete is limited to 5 tries per person per hour**, in the process's memory (`modules/account/attemptLimit.ts`). The other auth limit (OTP, per phone) counts rows in `otp_codes`; a refused delete leaves no row, so a counter was needed. One server process serves the app, so memory is enough; a restart only forgives. Over the limit: 429 `rate_limited`.
5. **The phone is shown partly hidden, built by the server** (amended by ADR-0068: the eye button may ask `POST /account/phone/reveal` for the owner's whole number, on request only) (`GET /account` → "+91 98••• ••210": the country code, two digits, three digits). The full number never reaches the Account screen.
6. **The look is per device.** System, Light or Dark in `localStorage` (`km-theme`, try/catch), applied as `data-theme` on `<html>`. `tokens.css` has the dark values twice (the media query guarded by `:not([data-theme='light'])`, and `[data-theme='dark']`); a test keeps them equal. The shop app is the same origin and shows the same choice. Nothing is stored on the server.
7. **The first-paint script is a file, not inline.** The page's Content-Security-Policy allows no inline script (ADR-0017), and loosening it for a theme was not worth it. `public/theme-init.js` is a plain same-origin script in `<head>`, run before the first paint, so there is no flash.
8. **"What shops can see" says what the code does.** A search shows a shop the item (and a catalog nickname), how many, a target price, a distance band (never a position), a photo if added, and whether delivery is wanted. A chosen shop also sees the order's lines, the first name only if the customer typed one, and the note; after it accepts, the address and a map pin. Never the phone. The draft said "never your name": the order form has an optional name and the shop sees its first word, so the text says so.

## Consequences

- A search that is still live (up to 15 minutes) blocks the delete with the order message, and the app has no button to close a search. The wording is the brief's; a clearer message for this case is a follow-up.
- Photos the customer added to a request stay with the request. Hard delete and data export are not built.
