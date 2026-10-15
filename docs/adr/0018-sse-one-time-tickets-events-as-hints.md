# 0018. SSE with one-time tickets; events as hints

Status: Accepted · 2026-10-15

## Context

Shops polled for new pings every 5 seconds, and seekers had no live view at all. Day 8 needs the shop app to feel instant, the seeker map to fill in as answers arrive, and a simulator (500 fake shops) to react to pings without 500 connections. The API may run as more than one instance, and the free tier sleeps and drops connections (ADR-0009, ADR-0015).

## Decision

- **Server-sent events**, not WebSockets. Traffic is one-way (server to client); answers already travel over plain HTTP POSTs. SSE is plain HTTP, reconnects by itself, and needs no library on either side.
- **One-time tickets, never the bearer token in a URL.** `EventSource` cannot send an `Authorization` header, and a URL ends up in logs, history and proxies. `POST /events/ticket` (any logged-in user) returns a random 256-bit ticket, stored in Redis as `ticket:<sha256>` with the user id and role, valid 60 seconds. `GET /events?ticket=` reads and deletes it in one step (`GETDEL`), so it works once, on any API instance. Request logs already keep the path only, so the ticket never reaches a log line; a test asserts it.
- **Events are hints.** The payload names what changed and nothing more: `request.updated {requestId, state}` to the seeker, `ping.created {pingId}` and `ping.closed {pingId}` to the shop. The client refetches the list on every event. A missed, duplicated or reordered event can therefore never leave the screen wrong, and no private data travels in a stream. The shop app also polls every 30 seconds as a fallback, and shows a small green dot only while the stream is open.
- **Fan-out through Redis pub/sub.** Every event is published to one channel; each API instance holds a dedicated subscriber connection and delivers to the streams it owns, filtered by user id. This works unchanged with one instance or several. If Redis is away, publishing logs a warning and carries on: a request never fails because an event was lost.
- **Publish after the transaction commits, never inside it.** A client told "ping created" will fetch it at once; if the event left before the commit, it would find nothing. Every publish sits after `withTransaction` returns, and a test publishes through a recorder that checks, from another connection, that the row is already visible.
- **Heartbeat and clean-up.** A comment line (`: heartbeat`) every 20 seconds keeps proxies from closing an idle stream. The connection is removed from the hub when the client closes it, and on shutdown all streams are ended first, because `server.close` waits for open connections.
- **Reconnect with a new ticket.** On error the client closes its `EventSource` itself (the browser's own retry would reuse a used-up URL), waits, fetches a new ticket and reopens, with the wait doubling up to 30 seconds.
- **One admin stream for the simulator.** `GET /admin/sim/events?ticket=` carries `ping.created` for all simulated shops with the data a simulator needs (shop id, item, reference price). It is the one place events carry data, and it is admin-only. See the admin role below.
- **Admin role from config.** `ADMIN_PHONES` (comma-separated, empty by default) lists phones that become `admin` on login. Admin endpoints answer 404 to everyone else, including a stored admin whose phone left the list, and are not mounted at all when the list is empty: fail closed.

## Alternatives rejected

- **WebSockets:** two-way and stateful for a one-way need; needs a library, its own auth handshake and sticky routing considerations.
- **Long polling or shorter polling:** simpler, but 5-second polling from every shop is exactly the Redis and database cost we are trying to cut, and it is never instant.
- **Bearer token in the query string, or a cookie:** the first leaks into logs; the second makes the session ambient and needs CSRF protection (see ADR-0017).
- **Events that carry the data (full ping, full request):** saves one fetch, but a lost event leaves stale or wrong state, and private fields would travel in a stream.
- **Per-user Redis channels:** one subscription per connected user; a single channel with in-process filtering needs one subscriber per instance.

## Consequences

- Each API instance holds one extra Redis connection (the subscriber) and every open stream holds a socket. Fine for hundreds of shops on one free instance; revisit at thousands.
- A stream open keeps the free instance awake, which is wanted during a demo and costs Redis commands only for publishes and heartbeat-free pub/sub.
- Without `REDIS_URL` realtime is off: ticket requests answer 503, the shop app falls back to its 30-second poll.
- Events cost a few lines at each place a state changes (`announceTransition`, `answerPing`, `fanOutPings`). New state changes must publish after their commit.
