# ADR-0064: Keep-awake pinger and bounded job retention

Status: accepted. Builds on ADR-0015 (expiry sweeper) and ADR-0063 (health details). Changes the free-tier sleep behaviour described in the runbook.

## Context

Results are announced on Nov 6. An UptimeRobot monitor will hit `GET /` every 10 minutes until then, so the free Render API never sleeps and the workers and the 60 s expiry sweeper run around the clock. An audit found a bug that this exposes: the sweep job scheduler set no `removeOnComplete`, so BullMQ kept every finished sweep (about 1,440 a day) in a 25 MB, `noeviction` Redis. A full Redis makes `queue.add` fail, which stops expiry, fan-out, push and the autopilot.

## Decision

1. **Keep awake with a pinger.** One UptimeRobot monitor on `/` every 10 minutes, email alerts. `/` and not `/ready`: it wakes the API without a database query. Deleted after Nov 6.
2. **One retention policy for every queue.** `workers/jobRetention.ts` holds it: completed jobs 1 hour or 200, failed jobs 7 days or 500. All five queues (expiry, ping fan-out, push, errand, demo autopilot) take it as `defaultJobOptions`, and the sweep scheduler's template carries it too. Per-job overrides stay only where they mean something: fan-out and expiry jobs are removed on completion (their job id must be free again), keyed pushes are kept a day (the "once per request" key).
3. **A bounded start-up clean-up** removes completed jobs older than 1 hour (a day for the push queue), 1,000 at a time, at most 50 batches per queue, logging counts. It touches only the completed set, never waiting, active, delayed or failed jobs, and is safe to repeat.
4. **Redis memory is visible.** `/admin/health/details` reports `used_memory` and `maxmemory` only (from one reused, short-timeout connection; "unknown" with a 200 if `INFO` fails); `scripts/release-check.sh` warns above 40 % and fails above 60 %.

## Alternatives rejected

- **Only `removeOnComplete: true` on the sweep.** Fixes today's leak, not the next queue added without it.
- **An eviction policy on Redis.** BullMQ needs `noeviction`; eviction would silently drop live jobs.
- **A paid Redis or Render plan.** Out of budget for six days.
- **Sleeping on the free tier.** Keeps Neon hours low but each wake costs about 14 s of cold start in front of a judge.

## Consequences

- Cold start (about 14 s) is traded for Neon compute hours: the free plan is 100 CU-hours a month, about 62 are projected for October and about 36 for Nov 1 to 6. Render's 750 free hours cover a full month (about 744). The weekly check in the runbook says when to pause the pinger.
- Measured (load/idleQueries.perf.ts, both `statement` and `execute` lines): an awake, idle API runs about 10 queries a minute from the sweeper, so Neon does not suspend while the API is awake. The pinger therefore decides the Neon hours: awake 24/7 means compute 24/7.
- Failed jobs are now kept 7 days, not 100 jobs; the O1 failed-job logs and the 24 h failure count in the details are unchanged.
- The first deploy clears what already piled up in production.
