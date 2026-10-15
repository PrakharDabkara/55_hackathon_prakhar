# 0015. Expiry: database deadline + queue as accelerator

Status: Accepted · 2026-10-15

## Context

A request must expire after 15 minutes. Two facts of the free tier (ADR-0009, ADR-0010) make a queue alone unsafe: the Render web service sleeps after 15 minutes idle, so an in-process worker is not running when a job comes due; and Render Key Value has no persistence, so a restart loses delayed jobs. A request must never stay PINGING for hours because a job vanished.

## Decision

**Postgres is the source of truth.** Every request has `expires_at`. Three mechanisms, in order of how much we trust them:

1. **Lazy expiry on read.** `GET /requests/:id` compares `expires_at` to the database clock; an overdue PINGING request becomes EXPIRED (an overdue ANSWERED one becomes CLOSED) and the transition is saved, so everyone who looks afterwards sees the same state. Works with no worker and no Redis.
2. **Sweeper.** A BullMQ repeatable job every 60 s finds overdue PINGING/ANSWERED requests and fires `TIMEOUT`. It covers lost jobs after a Redis restart and instance sleep, as soon as the instance is awake.
3. **Delayed job per request** (queue `request-expiry`, job id `expire-<requestId>`, so it cannot be added twice). It makes expiry timely, to the second, when everything is healthy. It is an accelerator, not a guarantee. (BullMQ rejects a custom id containing `:` once it has two colons, so the id uses `-`, not `expire:<id>`.)

**Every transition is one guarded UPDATE** (`UPDATE requests SET state = $to, version = version + 1 WHERE id = $1 AND state = $from RETURNING ...`) plus a `request_events` insert in the same transaction. Postgres re-checks `state = $from` on the row after waiting for a concurrent writer's lock, so of two concurrent events exactly one updates the row; the other updates zero rows, reloads, and reports the current state. It never overwrites. A test fires `SHOP_SAID_YES` and `TIMEOUT` at the same request ten times; with the `state` guard removed it failed 3 runs out of 3, within the first two rounds. (An early version of the test wrongly expected exactly one applied event; when one event commits before the other reads, the second legitimately moves the request on, which CI caught. The test now asserts exactly one move out of PINGING and an unbroken history.)

Workers run inside the API process (`WORKERS_ENABLED`, default true) and close in the graceful shutdown after the server stops and before the pool.

## Alternatives rejected

- **Queue only:** a lost or late job leaves a request open forever.
- **A separate worker service:** free Render has one web service; a second costs money and adds a deployment to run.
- **Redis TTL keys / keyspace notifications:** same persistence problem, and fragile on managed Redis.
- **SERIALIZABLE transactions or `SELECT ... FOR UPDATE`:** work, but a guarded UPDATE is one statement and the lost race is an ordinary result, not a retry loop.

## Consequences

- While the instance sleeps nothing expires; the first request after wake-up, the sweeper, or a read fixes it. Staleness is bounded by how long nobody looks.
- A job can fire a hair before the database deadline (clock skew); it carries 250 ms of slack and the sweeper catches any miss.
- A `TIMEOUT` that loses a race to `SHOP_SAID_YES` is not retried; the request is ANSWERED and the sweeper closes it later.
- Two API instances would both run the worker and sweeper: safe, because of the guarded UPDATE and the unique job ids.
- Each transition is one log line (request id, from, to, event, reason) and one `request_events` row, which also gives "time to first yes".
