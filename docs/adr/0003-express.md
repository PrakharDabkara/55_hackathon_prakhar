# 0003. Express as the API framework

Status: Accepted · 2026-10-12

## Context

The hackathon is judged on how well the product is built and how AI is used, not on framework choice. Learning a new framework would take time from scaling and AI work.

## Decision

Use Express for the API.

## Consequences

- No learning curve; time goes to scaling, reliability and the AI layer.
- Validation, typing of handlers and error handling must be added by us (schemas live in `packages/shared`).
- Raw throughput is lower than some alternatives; load tests (Day 14) decide whether that matters.
