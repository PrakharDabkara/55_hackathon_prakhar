# 0016. Late answers still teach inventory

Status: Accepted · 2026-10-15

## Context

A request lasts 15 minutes, but shopkeepers answer when they get to it. When a request is answered, expires or is closed, its other pings are no longer useful to the seeker. A shopkeeper who answers a few minutes later has still given us what the product is built on: a fresh "yes, I have it, at this price".

## Decision

- When a request leaves PINGING, its pings still SENT become `NO_REPLY` in the same transaction as the request transition. The shop's list shows only SENT pings of live requests, so they disappear from the list.
- A `NO_REPLY` ping can still be answered for 24 hours after it was sent. A yes updates `shop_stock` exactly like a live yes (price, quantity hint, confirmation time, expiry) and sets `pings.late = true`. It never touches the request: no state change, no event.
- Answers are accepted once. A second answer returns the stored one. A ping older than 24 hours answers 409 `ping_closed`.
- The seeker sees only live answers as "Confirmed N min ago". A late yes appears as learned stock ("Had it today") for later requests, which is its purpose.
- Lock order is request row first, then pings, in every path (transitions, answers, fan-out). That makes "answer vs. timeout" a plain ordering, never a deadlock: whichever takes the request lock first decides whether the answer is live or late.
- A request past its deadline that nobody has expired yet is expired first by an answer arriving, so the answer counts as late and cannot revive it.

## Alternatives rejected

- **Reject answers after the request ends:** throws away the cheapest inventory signal we get, and the shopkeeper sees an error for doing the right thing.
- **Let a late yes answer the request:** the seeker may have left or closed it; results would change under them.
- **Keep the ping SENT until its own timeout:** shops would be asked about requests nobody is waiting for.

## Consequences

- Stock grows from every answer, not only from answers that arrived in time.
- Learned stock can be as old as 24 hours at the moment of the first answer; it still expires 7 days (3 if "a few") from the answer.
- If a fan-out job is lost (Redis restart), the request is never pinged and expires on time; nothing is left half-done. A sweeper for un-pinged requests is a possible later hardening.
