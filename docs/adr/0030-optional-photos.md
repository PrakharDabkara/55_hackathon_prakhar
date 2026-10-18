# 0030. Optional photos on both sides

Status: Accepted · 2026-10-18 (extends ADR-0018, ADR-0028)

## Context

Words are not always enough: "that brush with the long handle", or a shop answering "yes, this one". A photo helps both sides, but it must never be required, never leak where someone was, and never fill Neon's free 0.5 GB.

## Decision

1. **Where.** A customer may attach one photo to a single search and to any item of the errand checklist ("Photo jodein"). A shop may attach one photo when it answers yes. The shop sees the customer's photo on the request card, the customer sees the shop's on the result or plan card; tap to enlarge. No screen asks for a photo.
2. **Client.** The browser shrinks to at most 1024 px on the longest side and encodes a JPEG of about 100 KB (a canvas copy carries no EXIF, so GPS stays on the phone). Upload goes through `XMLHttpRequest` for progress; failures are plain messages and the screen carries on without the photo.
3. **Server, trusting nothing.** `POST /photos?role=request|answer`, raw body, at most 400 KB (`413 photo_too_large`). The type comes from the magic bytes only: JPEG, PNG, WebP (no SVG, no GIF; `400 invalid_image`). `sharp` decodes (with a pixel limit against decompression bombs), applies the orientation, drops every piece of metadata, and writes a fresh JPEG of at most 1024 px. The result is what is stored.
4. **Storage.** Postgres table `photos` (migration 015): random uuid, owner, `bytea`, mime, size, `created_at`, and links to the request (customer photo), the ping (shop photo) or an errand and checklist label (until the agent opens that item's request, when `linkErrandPhoto` attaches it). 10 photos per user per 24 hours (`429 photo_limit`). A configurable cap, `PHOTO_STORAGE_CAP_MB` (default 300), refuses uploads above it (`503 photo_storage_full`) and every upload logs the total stored size. A sweeper (every 10 minutes inside the 60 s worker sweep) deletes photos 7 days after their request expired, and photos never attached after 24 hours.
5. **Serving.** `GET /photos/:id` with the login only. A customer's photo is visible to that customer and to the shops the request went to (a ping exists); a shop's photo to that shop and the customer who asked; a photo not yet attached to its uploader alone. Everyone else gets `404`, so existence is not leaked. `Cache-Control: private`, `nosniff`. The web app fetches with the bearer token and shows a `data:` URL, which the existing CSP (`img-src 'self' data:`) already allows: the CSP is unchanged and same-origin.
6. **No photo ever leaves the server for a model or any other service.** Tool results and prompts never carry a photo or its id (tested). The errand view's plan item carries the shop's `photoId` for the client only.

## Storage estimate

The client aims at 100 KB; the server's re-encode (quality 78) of such a picture is about 70 to 100 KB. At 100 KB the 300 MB cap holds about 3,000 photos; at the 400 KB worst case about 750. With photos kept 7 days past a 15-minute request, that is roughly 400 photos a day in steady state (200 asks that each get a shop photo), well above what a demo produces, and the per-user limit of 10 a day bounds one account. The rest of Neon's 0.5 GB is rows measured in kilobytes. If the cap is reached, uploads are refused with a message and everything else works.

## Consequences

- Photos live in the database: backups carry them, and the cap and the sweeper are the control. Object storage would be the next step at real scale.
- A photo that is uploaded but never used costs space for up to a day.
- `sharp` is a new dependency (native prebuilt binaries), named in the task; nothing else was added.

## Alternatives rejected

- **Public signed URLs or cookies for `<img>`:** more surface; fetching with the login and a `data:` URL keeps the CSP as it is.
- **Trusting the client's resize and type:** the server checks magic bytes, size and pixels and re-encodes anyway.
- **Keeping the original:** it carries GPS and more than anyone needs.
- **Sending photos to the model to describe them:** forbidden by the privacy rule.
