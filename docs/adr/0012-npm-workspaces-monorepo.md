# 0012. npm workspaces monorepo

Status: Accepted · 2026-10-15

## Context

The product has five packages: `api`, `web`, `mcp-server`, `simulator` and shared types. They change together (a new field touches the schema, API, web app and simulator).

## Decision

One repository using npm workspaces (`apps/*`, `packages/*`), one lockfile, one CI pipeline. Shared types and zod schemas live in `packages/shared`.

## Alternatives rejected

- **Separate repos:** version drift between apps and shared types, and duplicated CI.
- **Nx or Turborepo:** more tooling than five packages need; plain workspaces and npm scripts are enough.

## Consequences

- A change across apps is one atomic PR, tested by one CI run.
- CI runs everything; revisit caching or a task runner only if CI time becomes a problem.
- Modules and apps import each other only through public entry points (`index.ts`).
