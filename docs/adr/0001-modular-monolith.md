# 0001. Modular monolith

Status: Accepted · 2026-10-12

## Context

One developer, 17 days, and nine domains (identity, shops, catalog, search, requests, messaging, realtime, ai, analytics). Microservices would spend that time on plumbing.

## Decision

Build one Node.js + TypeScript API as a modular monolith. Each module exposes a public `index.ts`; modules import only each other's public index. Slow work runs in workers off Redis queues.

## Consequences

- One deployable, one CI pipeline, simple local setup.
- Module boundaries are kept by convention and lint, so a module can be split out later if load demands it.
- One process failure affects every module until workers and API are scaled separately.
