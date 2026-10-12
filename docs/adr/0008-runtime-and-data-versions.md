# 0008. Runtime and data versions

Status: Accepted · 2026-10-13

## Context

We need pinned runtime and data versions that CI, local Docker and the EC2 box share. Node 20 reached end of life on 2026-04-30. The `postgis/postgis:17-3.5` image is Debian 11, whose PGDG apt repository no longer exists, so pgvector cannot be installed there. `testcontainers` 12.x needs Node 22.22 or newer.

## Decision

- **Node 24 LTS** (`.nvmrc`, CI, `engines`).
- **PostgreSQL 18 + PostGIS 3.6 + pgvector 0.8.x**, from `postgis/postgis:18-3.6` (Debian 13) with pgvector installed by apt at an exact pinned version.
- **Redis 8.8** (`redis:8.8.3-alpine`).
- **Testcontainers 12.x**.

## Alternatives rejected

- **Node 20:** end of life, and it blocks Testcontainers 12.
- **Postgres 17 (`17-3.5`):** the base image cannot install pgvector via apt. Building pgvector from source would work but adds a compile step to maintain.
- **Alpine Postgres images:** pgvector is not available from apt there.

## Consequences

- Postgres 18 images keep data under `/var/lib/postgresql` (the compose volume mounts there), not `/var/lib/postgresql/data`.
- Bumping Postgres, PostGIS or pgvector means changing `infra/postgres/Dockerfile`, `docker-compose.yml` and this ADR together.
- Production data moved from another major version would need `pg_upgrade` or dump and restore; there is none yet.
