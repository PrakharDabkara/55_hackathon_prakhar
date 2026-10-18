# 0035. "Le liya?" and "Aaj ki maang" (Day 16, PR G)

Status: Accepted · 2026-10-19 · no new dependency, no AI.

## Context

Learned stock fades with age but is never checked against the street. A customer who walks to a shop knows whether the item was there. And a shop that answers one-tap pings has no view of what its neighbourhood is asking for. Both are answered from data the app already holds.

## Decisions

### Le liya?

1. **The tap is the signal.** "Raasta" on a result card, or "Raasta kholo" on a plan, notes one visit per pickup shop and item (`pickup_visits`, migration 020; `POST /pickups`). Not for a shop the customer has a delivery order with, nor for a delivery-mode plan item. Noting is best effort and never delays the route.
2. **Only real things.** The server accepts a visit only for the customer's own search or errand, and a shop that has a record of that item (so nobody can plant a question about a shop they never saw). One row per (customer, shop, item): that is also "ask at most once"; a later tap, or an answered question, adds nothing.
3. **When we ask.** The home screen asks 15 minutes after the tap (`PICKUP_ASK_AFTER_MINUTES`, 0 to 240), one question at a time, up to 3 waiting: "Kya aapko <item> <shop> par mila?" with "Mil gaya", "Wahan nahi tha", "Gaya nahi". If the home screen has not asked an hour after the tap, the existing push module sends one push per customer ("Kya aapko <item> mila?", the item name only, link `/app/`), counted against the same 5-a-minute limit. A question the home screen has shown is never pushed.
4. **Mil gaya.** The shop's answer is as fresh as if it had answered now (same fading rule), keeps its price, quantity and delivery, and is marked `customer_verified_at`; cards then say "Grahak ne confirm kiya" (learned cards only). One earlier wrong report is forgiven. A new answer from the shop itself clears the mark.
5. **Wahan nahi tha.** The learned answer stops counting at once (`expires_at` = now, so it is no longer "Likely" anywhere learned stock is read) and `wrong_reports` goes up by one for that shop and item. From 2 reports a shop's learned answer for that item ranks after the others, whatever its age, in the learned order and in the result list (a live yes from the shop still wins). The reason is never shown. Errands read the same learned order; their prompt, tools and plan are untouched.
6. **Gaya nahi.** Nothing changes except that the question is closed.
7. **Anonymous by construction.** The stock row carries a counter and a timestamp and no customer; the shop has no route to `pickup_visits`; the answer is applied to (shop, item) only. A test lists everything a shop can read and checks no customer id or phone is in it. Visits are deleted 30 days after the tap (hourly sweep).

### Aaj ki maang

8. **Shop screen card**, `GET /shops/me/demand`, all from the database, "today" in India time:
   - requests received, answered (yes or no) and said yes: this shop's pings sent today;
   - "Log ye pooch rahe the": items asked of this shop today that it said no to or never answered, with counts (top 10);
   - "Aas-paas ki maang": items in the shop's categories asked within 3 km of it today, listed only when **3 or more different customers** asked, as item and that number (top 10).
9. **Privacy.** The response has item names and numbers, nothing else. The 3-customer floor is in the SQL (`HAVING count(DISTINCT user_id) >= 3`), so no code path can return a smaller group; customers are counted, not searches, so one person asking five times is one. Tests check the floor, the distinct counting and the shape of the response.
10. The card is best effort: if it cannot be fetched it is absent, and the questions never wait for it.

## Consequences

- Migration 020 adds two columns to `shop_stock`, `pickup_visits` and two indexes; it only adds.
- New modules `pickups` and `demand`; `shops` gains three small stock functions; `push` gains one kind (`pickup_ask`) and `remindPickups`.
- The reminder runs inside the existing 60-second sweep; without push keys there is no reminder, and the home screen still asks.
- No agent, resolve or eval change; no label is needed.

## Alternatives rejected

- **Asking at once on the next app open:** coming back from the map to the home screen would ask before the customer has walked anywhere. The wait is configurable.
- **Letting the shop see reports** ("2 customers said you did not have it"): useful to the shop, but with a few customers it points at a person. The shop only sees the effect.
- **Deleting the stock row on "Wahan nahi tha":** it would lose the counter, so a shop that keeps saying yes to something it lacks could never be ranked down.
- **Counting searches, or showing the area from 1 customer:** a number of 1 or 2 can identify someone in a small area.
