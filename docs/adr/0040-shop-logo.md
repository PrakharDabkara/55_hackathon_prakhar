# 0040. Shop logo (Day 17, PR K)

Status: Accepted · 2026-10-19 · no new dependency · migration 023. Extends ADR-0030 (photos) and ADR-0035 (the shop screen).

## Context

The new shop screen needs three things the API did not give: the price a shop last quoted on a ping card, a week view of "Aaj ki maang" with how fast the shop answers, and a logo that customers see beside the shop's name.

## Decisions

1. **`lastPricePaise` on `ShopPing`.** Read from the shop's own `shop_stock(shop, item)` row; `null` when there is no row, no price, or a customer called the answer wrong and the shop has not answered since (`invalidated_at` after `last_confirmed_at`). It is the shop's own number, so it is added to the allow-list on purpose.
2. **Demand window.** `GET /shops/me/demand?days=1|7`, default 1, anything else is a 400. `today.*`, `asked[]` and `nearby[]` cover the window (midnight in `Asia/Kolkata`, `days - 1` days back); field names stay, `days` is added. `avgReplySeconds` is the mean of `answered_at - sent_at` over this shop's YES and NO pings that are not late, in the window; `null` when there are none. The three-customer minimum for `nearby[]` is unchanged.
3. **The logo is a photo.** Migration 023: `photos.role` gains `logo`, `photos.shop_id` (FK shops, cascade) owns it with one logo per shop (partial unique index), `mime` may be `image/webp`, and `shops.logo_photo_id` (FK photos, `ON DELETE SET NULL`) points at the current one. The existing pipeline is reused: magic bytes, the pixel limit, the 400 KB limit, the storage cap, sharp re-encode with no metadata. The result is a centre-cropped 512 px square webp.
4. **Endpoints.** `POST /shops/me/logo` (shop owner; raw image body like `POST /photos`, since the repo has no multipart parser and no new dependency was approved) stores the new logo and deletes the old row in one transaction, and answers `{ logoUrl }`. `DELETE /shops/me/logo` removes it (204, also when there is none). `logoUrl` is `/photos/<id>`.
5. **Reading.** `GET /photos/:id` serves a `logo` to anyone, signed in or not, with `Cache-Control: public, max-age=31536000, immutable`; a new logo has a new id, so a cached one never goes stale. Every other role keeps today's rules (sign-in, then the owner or the people in the loop, else 404). The sweeper never drops a logo as "unattached".
6. **Where `logoUrl` appears.** `GET /shops/me`, each search result (live and learned), and the customer's order views (order page, Mere orders), always present and `null` when there is none. Only the picture address: no owner id, phone or user id. A privacy test walks every logo endpoint and view for them.

## Consequences

- A logo is public by the shop's choice; the upload screen should say so.
- `shops.logo_photo_id` makes a `TRUNCATE requests|errands|photos … CASCADE` reach `shops`. Only tests do that; they now use `truncateKeepingShops` (`src/testing/truncate.ts`), which drops the link for the truncate and puts it back.
- No LLM prompt or tool schema changed, so no eval run.

## Alternatives rejected

- A separate `shop_logos` table: a second copy of the storage cap, the sweeper and the reader for one extra column's worth of difference.
- A plain `logo_photo_id` without the foreign key: it would spare the test helper, but the database would no longer clear it when the photo goes.
- A private logo behind sign-in: customers see it before they know the shop, and public caching is the point.
