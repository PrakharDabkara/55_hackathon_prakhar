# 0023. One tool registry, two surfaces: MCP and the internal agent

Status: Accepted · 2026-10-22

## Context

Day 11 gives any AI assistant tools to use KahanMilega (an MCP server). Day 12 builds our own errand agent that uses the same capabilities with Gemini function calling. Two separate tool lists would drift: a renamed field, a changed description or a looser schema in one place and not the other. A tool is also more than a function: its description is the only instruction an AI gets about when to use it, and a tool that pings real shops must say so.

## Decision

1. **One registry** in `packages/shared/src/tools` (import path `@kahanmilega/shared/tools`, a subpath so the web bundle does not pull in zod). Each tool is a plain object: `name`, `title`, a `description` written for an AI reader (what it does, when to use it, what to call next), a zod `input` schema, a zod `output` schema, and two flags: `sideEffects` (changes the world) and `idempotent` (repeating the call changes nothing more). Six tools, in errand order: `resolve_item`, `find_item_nearby`, `ask_shops`, `get_request_status`, `close_request`, `plan_route`. It sits in `shared` rather than in the API because the MCP server has no database and must not import API code, and the API imports it too (for `POST /route/plan`).
2. **Two surfaces, one definition.** The MCP server registers each tool with the SDK (schemas, descriptions, and MCP annotations derived from the flags: `readOnlyHint = !sideEffects`, `idempotentHint`, `destructiveHint = false`). The Day 12 agent will turn the same objects into Gemini function declarations with `toJsonSchema(tool)`. What differs is only the executor: the MCP server runs a tool by calling the public HTTP API; the agent will run it in process against the services. The contract (input and output) is the shared part.
3. **The MCP server is a client of the public API**, with the user's own seeker token over HTTP. No database access, no admin powers, no LLM inside. The token comes from a git-ignored file written by `npm run mcp:login` (the demo OTP flow; it prints "logged in", never the token), and is read on every call, so logging in again needs no restart. An assistant can therefore do only what that customer could do in the app.
4. **Side effects are declared, not implied.** `ask_shops` pings real shops, so it is marked not read-only and not idempotent, and its description tells the AI to use it only after `find_item_nearby` finds fewer than 3 fresh shops. An optional `idempotencyKey` (sent as the API's `Idempotency-Key` header) makes a retry return the same request instead of pinging twice. `close_request` is a side effect but idempotent.
5. **Errors are results an AI can act on.** A 422 `item_ambiguous` is a normal result (`clarification` with the question and options), because asking the user is the correct next step. 401 says to run `npm run mcp:login`; 429 says rate limited, retry later; 404 names the missing request; 400 repeats what the API disliked; an unreachable API names the address and never the token. Bad input is refused by the schema before any call.
6. **Small API additions the tools needed:** `POST /route/plan` (haversine distances, exact best order by trying every order for up to 8 stops, no return trip; distances are straight-line, not road) and `q` is now optional on `GET /search` and `POST /requests` when an `itemId` is given (the tools hold the id, not the text).

## Alternatives rejected

- **Hand-written tool lists per surface:** they drift. A snapshot test of the MCP tool list (names, schemas, annotations) now guards the contract.
- **The MCP server importing API services or reading the database:** it would carry admin-grade power into every assistant that connects, and bypass auth and rate limits.
- **One `search` tool that resolves, reads and pings:** an AI could ping shops without meaning to. Splitting reads from the one side effect lets the host ask for confirmation on `ask_shops` alone.
- **Putting the registry in the API and having MCP import it:** the MCP server would depend on the whole API package.
- **A heuristic or LLM route planner:** for at most 8 stops the exact answer is 40,320 orders and takes milliseconds.

## Consequences

- A tool change is one edit in `shared`; the snapshot in `apps/mcp-server/src/__snapshots__` shows exactly what changed for clients, and must be updated on purpose.
- Straight-line distances can understate road distance; the descriptions say so.
- `resolve_item` calls `GET /search`, which needs a location the API ignores for resolution (the tool sends 0,0), and writes a `search_queries` row; both are harmless.
- The Day 12 agent must still decide its own guardrails for side-effecting tools (budgets, confirmation); the registry only labels them.
