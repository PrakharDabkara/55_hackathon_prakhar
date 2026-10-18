# 0034. Web Push notifications (Day 16, PR F)

Status: Accepted · 2026-10-18 · adds one dependency, `web-push`, with the owner's approval.

## Context

Shops must see a new question or order, and customers an answer, without keeping the app open. The app is a PWA, so the standard tool is Web Push (VAPID). A push passes through the browser maker's servers (Google, Mozilla, Apple), so what it says matters. No AI is involved.

## Decisions

1. **Keys.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or `https:`) from the environment. All three set turns push on; anything less leaves it off, with one warning at startup, never a crash. `npm run push:keys` makes a pair and prints it for the owner to put in Render; nobody else runs it. The public key is served at `GET /push/config`; the private key never leaves the server.
2. **Subscriptions.** `push_subscriptions` (migration 019): user, unique endpoint, keys, `created_at`, `last_success_at`. `POST /push/subscribe` is an upsert (a browser someone else logs in on moves to them; 10 devices per person, the oldest goes), `POST /push/unsubscribe` removes this device. A 404 or 410 from the push service deletes the row.
3. **The endpoint is checked.** The server later posts to the address a client gives it, so only `https` addresses on the four push services (`*.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) are accepted. This closes the request-forgery door (private addresses, metadata services, other sites).
4. **Permission only on a tap.** A "Notification chalu karein" button on the customer home and the shop screen asks; the page never does. The same button becomes "Notification band karein". On an iPhone outside the Home Screen app it is disabled with "Pehle 'Add to Home Screen' karein". A device that already has a subscription tells the server again on load, which is not a prompt.
5. **Events, after commit.** The notifier listens to the realtime events the app already publishes after each commit (ADR-0018), looks up the item name, and queues one job per browser on the BullMQ queue `push` (5 tries, exponential backoff). Shop: new ping ("Naya sawaal: item"), new order ("Naya order: item"). Customer: first answer to a search ("Dukaan ne jawab diya: item"; job id `answer:<requestId>`, held 3 s, kept a day, so a burst is one push), "Plan taiyaar", and order accepted, declined, out for delivery, delivered. Never for simulated shops (`is_simulated`). While an errand is planning, its own searches do not push; "Plan taiyaar" is the one push.
6. **Payload privacy.** `{title, item, url}` and nothing else, built by one function that is only given an item name and an id. The item name has phone-like and coordinate-like runs removed and is cut to 60 characters. The link is `/app/shop`, `/app/request/<id>`, `/app/errand/<id>` or `/app/order/<id>`. A test checks the keys and the links of every kind and that no address, name, phone or coordinate reaches a queued push. Logs carry the subscription id and a status, never the endpoint, keys or payload.
7. **Rate limit.** At most 5 pushes per person per minute (`PUSH_MAX_PER_MINUTE`), a fixed-window counter in Redis, counted once per notification, not per device. Over the limit a push is dropped. If Redis is slow the push goes out (a missed limit costs a buzz, a missed push costs an order).
8. **Service worker.** `public/sw.js`, plain JavaScript, scope `/app/`, no caching. It shows the notification (one per link, so a second ping replaces the first) and on a tap focuses the tab already on that page, else takes an open app tab to the link, else opens a window. A link outside `/app/` becomes the home screen. It is served `no-cache` so a fix reaches phones at once.

## Consequences

- One dependency (`web-push`, plus its types). It does the encryption and VAPID signing.
- Push needs Redis (the queue), like the other workers. Without it push is off and the app works as before.
- A push may reach a phone that has the app open. Accepted: it is a short title, replaced by the next one for the same page.
- Changing the public key cancels every subscription; people tap the button again.
- No agent, resolve or eval change; no label is needed.

## Alternatives rejected

- **Hand-written encryption (RFC 8291) with `node:crypto`:** less code to depend on, much more to get wrong.
- **Sending in the request that caused the event:** a slow push service would hold up an answer or an order.
- **One job per person, retried as a whole:** a retry would repeat the push on the devices that already got it.
- **Putting more in the payload** (shop name, price, address) **so the notification reads better:** it would pass through a third party; the app shows the detail after the tap.
- **A per-device limit:** a phone and a tablet would double the buzz for one event.
