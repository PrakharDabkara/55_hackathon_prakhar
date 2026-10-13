# 0010. Redis: Render Key Value, not Upstash

Status: Accepted · 2026-10-13

## Context

ADR-0009 needs a free Redis for BullMQ queues, the cache and pub/sub. Upstash free caps at 500,000 commands a month and bills every command, including the ones BullMQ sends while idle. We measured what that costs.

## Experiment

`apps/api/scripts/redis-idle-worker.ts`: one idle BullMQ `Queue` plus `Worker` on local Redis 8.8.3, `CONFIG RESETSTAT`, 600 s of nothing, then `INFO commandstats`.

| Result                    | Value                   |
| ------------------------- | ----------------------- |
| Commands in 600 s         | 1,200                   |
| Per second                | 2.0                     |
| Per 30-day month          | 5,184,000               |
| Share of Upstash free cap | about 1,040% (10x over) |

Mostly a fixed cycle per poll (`bzpopmin`, `zrangebyscore`, `zpopmin`, `evalsha`, `hmget`, `rpoplpush`, `ping`, `del` and others, about 119 each) plus a stalled-job check every 30 s. The numbers are a floor: one worker, no jobs, no producer. The sample is one run on one machine, and the script's own INFO call is counted (a handful of commands). Real use only adds commands.

## Decision

Use **Render Key Value (free)**, defined in `render.yaml` in Singapore next to the API, with `maxmemoryPolicy: noeviction` (BullMQ requires it) and no public access (`ipAllowList: []`).

## Alternatives rejected

- **Upstash free:** the idle worker alone would burn the monthly cap in about 3 days. Raising BullMQ's polling delay or using Upstash's HTTP client would trade away latency or the BullMQ API. Revisit if usage is pay-per-request and cheap.
- **Redis in the API container:** the free service has no persistent disk and the container is replaced on every deploy.

## Consequences

- Free Key Value has 25 MB and **no persistence**: a restart loses queued jobs and cache. Acceptable now because requests expire in 15 minutes and stock is in Postgres; ping state must be recoverable from Postgres (design rule for Day 6-7).
- Internal URL only, so local scripts cannot reach it. Use compose Redis locally.
- One free Key Value per Render workspace.
- AWS later: ElastiCache for Redis (or Valkey) behind the same `REDIS_URL`; nothing in the code changes.
