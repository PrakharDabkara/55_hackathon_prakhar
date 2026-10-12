# 0002. AWS: one EC2 instance with Docker Compose

Status: Accepted · 2026-10-12

## Context

We need a real cloud deployment with CI/CD, low cost, and support for long-lived SSE connections, which some serverless platforms cut off.

## Decision

Run one EC2 instance with Docker Compose: API, workers, Postgres (PostGIS, pgvector), Redis, and Caddy for HTTPS. Images are built in GitHub Actions and deployed on every merge to main.

## Consequences

- Cheap, simple, and SSE works without special configuration.
- Single point of failure; no managed backups or autoscaling.
- After the hackathon: move to managed database and Redis, then containers behind a load balancer.
