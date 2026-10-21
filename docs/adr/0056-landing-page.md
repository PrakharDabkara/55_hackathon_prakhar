# 0056. The landing page at the root (PR T)

Status: Accepted · 2026-10-22 · extends ADR-0017. No new dependency, no migration, no AI.

## Context

`/` answered 404. Judges and new visitors had no page that says what AskBuy is. We win shops first and buyers follow, so the page speaks to shopkeepers first.

## Decisions

1. **Static, no script.** `apps/web/landing.html` is a second Vite entry: plain HTML and one CSS file (`src/landing/landing.css`) built from the same tokens and the same self-hosted fonts as the apps. The only script is the existing `theme-init.js`, so a saved Light or Dark choice carries over.
2. **Served at `/` only.** `webRouter` sends `landing.html` at exactly `GET /` (and HEAD) with the `/app/` security headers (no inline script or style) and `Cache-Control: public, max-age=300`. Its assets are `/app/assets/*`, cached as for the app. If the file is not built, `/` answers the usual 404. `/health` (Render's check), `/app/` and `/app/shop` are untouched.
3. **Shop-first.** The hero, three steps and "why shops join" come before the buyers band.
4. **No demo credentials in public.** The page shows no phone number, one-time code or login hint, and tests fail on any 10-digit number or 6-digit code. The demo is "open both apps".
5. **Claims match the code.** Login is a one-time code the person enters (not "by SMS": ADR-0013 sends none). The customer's number is never shown to a shop, a first name only if typed, the address only once the order is accepted (ADR-0032). A list is one parchi per shop with the lines that fit it (ADR-0055). The plan is the fewest shops, then the shortest route (ADR-0025, 0055).
6. **Brand name** is written "AskBuy" and checked by `brand.test.ts` like the other static files. The Open Graph image is the 512 icon at the Render URL.

## Alternatives rejected

- A React route at `/`: ships the whole app bundle to a page with no state.
- A separate static host: another deploy, another origin, a second CSP.
- Serving the page at `/app/`: it would collide with the customer app's home.
