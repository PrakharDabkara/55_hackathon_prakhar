# 0011. Product direction: errand agent on the marketplace; shop delivery as stretch

Status: Accepted · 2026-10-15

## Context

Single-item search alone gives weak value: one item is a small errand, and the answer depends on many shops replying in time. Delivery is the obvious next step, but runner fleets are hard to run: Dunzo went offline in Jan 2025 and Swiggy Genie paused in several cities in 2025, so a runner fleet is rejected.

## Decision

Build three layers on the same marketplace (requests, pings, learned stock):

- **Find:** ask nearby shops for one item (the current plan).
- **Plan:** an AI errand agent takes a whole task, finds every item across shops and returns a shopping plan with prices and a route. Each item is "confirmed" (a shop said yes in this errand) or "likely" (learned stock only); it never claims unconfirmed stock. It is the product's centre.
- **Get (stretch):** the shop itself delivers, cash on delivery, on the user's explicit yes. A decline falls back to pickup.

The agent is our own tool-use loop on the Messages API with Claude Haiku 5.5 (Sonnet 5.5 only if evals fail), no agent framework. It is durable: errand state lives in Postgres and a BullMQ job resumes it on replies or timers, so no LLM call is held open while waiting. Starting guardrails: 10 items, 15 shops pinged, 12 LLM steps, a per-errand token budget, 15 minutes. An eval set of 20 errands gates CI.

Scope is frozen as of Oct 15; the build plan becomes 18 days (see BRIEF). If a gate slips, cut shop delivery first, then freshness extras, then load targets; never tests or deployment.

## Alternatives rejected

- **Single-item search only:** weak value and fully dependent on shop replies.
- **Runner delivery:** the Dunzo and Genie outcomes show the fleet cost and risk; deferred to the Later list.
- **An agent framework:** more dependency than a small loop needs, and less visible for evals and token accounting.

## Consequences

- New errand and order state machines, a plan/route tool and an agent eval set.
- The agent reuses the request/ping system, so the marketplace must be duplicate-safe and resumable (Postgres is the source of truth, as in ADR-0010).
- LLM cost per errand becomes a tracked metric with a hard budget.
- Real WhatsApp, payments and runner delivery stay out of the build.
