# ADR-0041: Parchi UI

Status: accepted · 2026-10-19

## Context

The shop app was one global stylesheet, Hinglish copy and green-on-white. Shops need a fast, thumb-first screen where a request looks like a paper slip (parchi) they can answer in one tap. The API already carries everything needed.

## Decisions

1. **Tokens first.** `apps/web/src/design/tokens.css` holds every colour, space, radius and type value, with a dark theme under `prefers-color-scheme`. Components use tokens only, never hex values.
2. **Paper only on request cards.** The parchi (torn edge, ruled lines, handwriting font, stamps) appears only on request cards, so it keeps meaning.
3. **One primary button per screen** (marigold). Marigold is never text colour.
4. **No new UI libraries.** Scroll-snap for the deck, inline SVG icons, our own sheet and drawer. Fonts (Mukta, Kalam) are self-hosted through `@fontsource`.
5. **English is the default language** across the web app; the hi table stays in parity. Customer copy is polished in a later PR.
6. **No customer identity in the shop app** before an order is ACCEPTED. After ACCEPTED the order shows the address and "For: {contactName}".
7. **Location is required to set up a shop**, chosen on a Leaflet map with a draggable pin (also in settings).
8. **One source for the brand name:** `BRAND_NAME` in `apps/web/src/brand.ts`. Static files (`index.html`, `manifest.json`, `sw.js`) cannot import it, so a unit test fails if any of them differ.
9. **Shop styles are scoped** under `.shop-app`, so the customer app is untouched until its own restyle.

## Consequences

- Fonts are bundled but the service worker caches nothing, so they are not available offline yet.
- The app has no answer queue, so offline shows "You're offline. Reconnect to answer."
- No backend change; client maps API names (`feePaise`, `cancelReason`, `itemsTotalPaise`) to UI wording.
