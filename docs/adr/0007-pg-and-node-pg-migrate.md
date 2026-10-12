# 0007. `pg` and `node-pg-migrate` for database access

Status: Accepted · 2026-10-13

## Context

The core queries are geo and vector queries (`ST_DWithin`, `ST_Distance`, pgvector similarity) on PostGIS `geography` and `vector` columns. Schema changes must be reviewable and reproducible in CI and on the EC2 box.

## Decision

Use `pg` for queries and `node-pg-migrate` for migrations, written as plain SQL files in `apps/api/migrations`. Modules take a `pg` queryable, so tests can pass their own connection.

## Alternatives rejected

- **Prisma:** no native `geography` or `vector` types, so the key queries would be raw SQL anyway; adds a schema language, a generated client and a build step.
- **Drizzle:** closer to SQL and has some PostGIS and pgvector helpers, but we would still hand-write the spatial queries and learn a query builder for little gain.

## Consequences

- No ORM: row mapping and typing of results are written by hand, and queries must be parameterised (never string-built).
- SQL migrations (`-- Up Migration` / `-- Down Migration`) are readable in review and run the same locally, in tests and in CI.
- Moving to an ORM later stays possible, because the SQL stays in the repo.
