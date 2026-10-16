# mcp-server

MCP server (stdio) for KahanMilega. A client of the public API with the user's own customer token: no database, no admin powers, no LLM. The tools come from the shared registry (`packages/shared/src/tools`, ADR-0023).

- `src/server.ts` registers the tools; `src/handlers.ts` runs each against the API and turns API errors into tool errors; `src/apiClient.ts` is the HTTP client; `src/main.ts` is the stdio entry; `src/loginMain.ts` is `npm run mcp:login`.
- Config: `KAHANMILEGA_API_URL` (default the live site), `KAHANMILEGA_TOKEN_FILE` (default `.kahanmilega-login.json` in this folder, git-ignored).
- Setup, connecting to Claude and example prompts: see the root README, "Use KahanMilega from Claude".
