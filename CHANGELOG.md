# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- npm-workspaces monorepo scaffold (`apps/*`, `packages/*`) per the brief's repo structure.
- Root tooling: TypeScript (strict), ESLint, Prettier, Vitest.
- Docs: README, CLAUDE.md, ADRs 0001–0006, PR template, `.env.example`.
- Local stack: `docker-compose.yml` with Postgres 18 + PostGIS 3.6 + pgvector 0.8.7 (`infra/postgres`) and Redis 8; `npm run db:up`, `db:down`, `db:migrate`.
- Database access with `pg` and `node-pg-migrate` (ADR-0007); migrations for extensions and the `shops` table with a GiST index.
- `findShopsWithinRadius` in the shops module, with a Testcontainers integration test.
- GitHub Actions CI: lint, typecheck, unit and integration tests; `.nvmrc` (Node 20).
