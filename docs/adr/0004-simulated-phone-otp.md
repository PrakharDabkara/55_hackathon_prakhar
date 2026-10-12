# 0004. Simulated phone OTP login

Status: Accepted · 2026-10-12

## Context

Shopkeepers and seekers in India expect phone-number login. Real SMS costs money and needs sender registration that does not fit the timeline.

## Decision

Implement the full phone OTP flow, but simulate delivery: the code is written to the dev log instead of sent by SMS.

## Consequences

- The real login flow, roles and rate limits are built and testable at no SMS cost.
- Not usable by real users until an SMS provider is plugged in behind the same interface.
- OTP codes in logs must never be enabled in production.
