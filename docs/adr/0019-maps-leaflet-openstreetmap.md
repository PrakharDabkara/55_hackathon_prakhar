# 0019. Maps: Leaflet + OpenStreetMap

Status: Accepted · 2026-10-16

## Context

The customer app shows which shops said yes on a map, filling in live. It must cost nothing to run (ADR-0009), need no key or billing account, and fit a strict Content-Security-Policy (ADR-0017). Seekers are on cheap phones, so the library must be small.

## Decision

- **Leaflet** (about 40 KB gzipped) draws the map; **OpenStreetMap** supplies the tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. No key, no account, no billing.
- **The map is one component** (`ResultsMap`). Everything else works with plain data (`pinsFor`, `sortResults`) and is tested without a map, because jsdom cannot render Leaflet; component tests replace `ResultsMap` with a probe. The real map is covered by the end-to-end test.
- **No marker image files.** Pins are inline SVG in `L.divIcon` (user orange, live answers green, remembered stock blue). Leaflet's default marker PNGs are never requested, and the SVG has no `style` attribute, which the CSP would block.
- **CSP:** `img-src 'self' data: https://tile.openstreetmap.org`. Scripts, styles and `connect-src` stay `'self'` only. Leaflet's own CSS is bundled by Vite, and the library sets positions through the DOM, which style-src permits. A test asserts every directive.
- **Tile usage policy.** We show the required attribution, "© OpenStreetMap contributors" with a link to openstreetmap.org/copyright, on every map. The policy also wants a valid Referer and no heavy use. The page sets `Referrer-Policy: no-referrer`, so the tile layer alone sends the origin (`referrerPolicy: 'origin'`). Tiles are cached by the browser, we never prefetch or bulk-download, and we load no tiles unless a results screen is open.
- **Directions** are a plain link to Google Maps (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`). It is a navigation, not an embed, so it needs no key and no CSP entry.

## Alternatives rejected

- **Google Maps JavaScript API:** needs an API key and a billing account, loads script from Google (a CSP hole), and charges per map load. Poor fit for a free-tier hackathon build.
- **Mapbox, MapLibre with a hosted style:** the same key-and-billing problem; MapLibre with our own tiles is more infrastructure than this slice needs.
- **A static image of the map:** no live pins and no panning.

## Consequences

- The public OSM tile server is a courtesy service with no uptime promise and a usage policy. It is fine for a demo and early use. Before real traffic we switch to a paid or self-hosted tile source; only the URL and the CSP entry change.
- The first map needs network access to OpenStreetMap; if tiles fail the pins and the list still work.
- The web bundle grows by Leaflet and its CSS (a few small image files that Leaflet's stylesheet names).
