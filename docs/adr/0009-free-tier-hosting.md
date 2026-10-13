# 0009. Free-tier hosting

Status: Accepted · 2026-10-13 · Supersedes [0002](0002-aws-ec2-docker-compose.md)

## Context

ADR-0002 chose one AWS EC2 box. For the hackathon we want a real deploy with CD at zero cost and no server to patch, so the cloud moves to free tiers. AWS stays the target once the project has money or load.

## Decision

| Piece    | Service                                               | Notes                                                                                              |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API      | Render free web service, Docker runtime, Singapore    | `render.yaml` Blueprint; deploys only via deploy hook                                              |
| Postgres | Neon free (PostGIS, pgvector)                         | Pooled URL for the app, direct URL for migrations                                                  |
| Redis    | See [0010](0010-redis-upstash-vs-render-key-value.md) |                                                                                                    |
| Web      | Cloudflare Pages                                      | Static React PWA, added with the web app                                                           |
| CI/CD    | GitHub Actions                                        | After CI passes on main: migrate Neon, then call the Render deploy hook with the tested commit SHA |

## Consequences

- **Cold starts:** Render free spins the API down after about 15 minutes idle, and the first request takes tens of seconds. Warm it before a demo. `/health` checks do not keep it awake.
- **No background worker on the free plan:** BullMQ workers run inside the API process until we pay for one.
- **Small box:** 512 MB RAM, so no heavy work in the API process.
- **Neon scales to zero:** the first query after idle is slow; the pool must tolerate dropped idle connections (it logs and carries on).
- **SSE:** long-lived streams on Render free are unproven; check on Day 8 and fall back to polling if needed.
- **Migrations are not rolled back with the code.** Keep each migration backward compatible with the previous release (expand, then contract).

## Alternatives rejected

- **Stay on EC2 (0002):** more to operate (OS, HTTPS, backups) and not free after the first year.
- **Fly.io / Railway:** no real free tier now.
- **Vercel / Lambda for the API:** serverless cuts long-lived SSE connections.

## After the hackathon: AWS

Target: API containers on ECS Fargate behind an ALB, Neon replaced by RDS PostgreSQL (or Aurora), Redis by ElastiCache, web on S3 + CloudFront.

Carries over unchanged: the Docker image, `/health` as the load balancer check and `/ready` as the readiness probe, env-only config validated at startup, graceful shutdown on SIGTERM, migrate-then-deploy ordering, and request IDs in JSON logs (to CloudWatch). Only the Render blueprint, the deploy hook and the secrets move: the hook becomes an ECR push plus an ECS service update.
