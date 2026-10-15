# 0017. Web app served by the API

Status: Accepted · 2026-10-15

## Context

Day 7b adds the first UI, the shop app, and the seeker app follows on Day 8. Deploys are free-tier (ADR-0009): one Render web service, auto-deployed from CI.

## Decision

- **One deploy, same origin.** The Express API serves the built Vite app under `/app/` (vite `base: "/app/"`). The Docker image builds the web app and the API serves `apps/web/dist`. API routes stay where they are. Because the page and the API share an origin there is no CORS configuration at all, and `connect-src 'self'` is enough.
- **Routing.** Static files are served as they are; any `GET`/`HEAD` under `/app/` for a path without a file extension gets `index.html` (client-side routes such as `/app/shop`). A missing script is a 404, not a page of HTML, and `POST /app/...` is an ordinary 404.
- **Strict Content-Security-Policy**, set by our own middleware on every `/app/` response: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. No inline script or style, no third-party origin, no web fonts. Also `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. A test asserts the header.
- **Token in localStorage.** The bearer token (ADR-0013) lives in `localStorage`. **Trade-off:** any script that runs on the page can read it, so an XSS bug would leak a 30-day session. We accept that because a shopkeeper's phone must stay logged in for days, and reduce the risk with the CSP above (no inline or foreign script can run), React's escaping of all text (shop and user text is data), and no `dangerouslySetInnerHTML`. Logout revokes the session server-side, so a stolen token can be cut off.
- **No service worker yet.** The PWA is only a manifest and icons (installable to the home screen); offline support is later.

## Alternatives rejected

- **Cloudflare Pages for the web app:** another account and another deploy, and a cross-origin API means CORS, preflight requests and a token that must be allowed to travel. Easy to move later: only the `base` and an API URL setting change.
- **An httpOnly cookie instead of localStorage:** immune to script theft, but it makes the session ambient, so every state-changing route would need CSRF protection, and the API, MCP server and tests all use bearer tokens. A larger change than this slice should carry; revisit if the threat model grows.
- **Express serving the files with no CSP:** the cheapest option, and the one that makes the localStorage trade-off unacceptable.

## Consequences

- The free instance sleeps after 15 minutes idle (ADR-0015), so the first page load after a pause is slow while it wakes.
- A web change redeploys the API and vice versa; at this size that is the point.
- The CSP forbids inline styles, so React `style={{...}}` props must not be used (they would be blocked); all styling is in one stylesheet.
- Local development: `npm run dev -w @kahanmilega/web` runs Vite with a proxy to an API on port 3000.
