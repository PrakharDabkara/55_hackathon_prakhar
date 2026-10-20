# 0050. The app is called AskBuy (Day 22, PR P)

Status: Accepted · 2026-10-20 · UI only; code names, package scopes and infrastructure names follow in the next PR.

## Decisions

1. **`BRAND_NAME = 'AskBuy'`.** The static files (`index.html`, `manifest.json`, `sw.js`, the `appName` strings) follow it; `brand.test.ts` now requires AskBuy in all four and none of the old name.
2. **One mark**, drawn once (`brandMarkGeometry.ts`): a small parchi slip with a torn top edge and two lines of ink, a marigold location pin at the lower right, on a `--brand` rounded square. The `BrandMark` component paints it with tokens; it appears in the customer header, the customer login sheet and the shop login. It is the one place a slip shows outside a request card, as a logo.
3. **Icons are generated once** by `npm run icons` (`apps/web/scripts/make-icons.ts`, Chromium through Playwright, which is already installed) into `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark inside the safe zone) and `favicon.svg`; the results are committed.
4. **Taglines:** customer "Ask the shops nearby, then buy."; shop login "AskBuy for shops — lift your shutter online in a minute."; the sidebar keeps "Powered by AskBuy". The brand in strings comes from `BRAND_NAME`.
5. **No push copy named the app**; only the service worker's fallback title does, so that is now AskBuy.

## Consequences

- Installed apps and notifications show the new name and icon; a phone may need to reinstall the PWA to refresh the home-screen icon.
