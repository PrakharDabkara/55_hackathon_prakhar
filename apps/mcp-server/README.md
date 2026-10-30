# mcp-server

MCP server (stdio) for AskBuy. A client of the public API with the user's own customer token: no database, no admin powers, no LLM. The tools come from the shared registry (`packages/shared/src/tools`, ADR-0023).

- `src/server.ts` registers the tools; `src/handlers.ts` runs each against the API and turns API errors into tool errors; `src/apiClient.ts` is the HTTP client; `src/main.ts` is the stdio entry; `src/loginMain.ts` is `npm run mcp:login`.
- Config: `ASKBUY_API_URL` (default the live site), `ASKBUY_TOKEN_FILE` (default `.askbuy-login.json` in this folder, git-ignored).

## Set up

1. Build and log in (the live site by default; Node 24 and `npm install` first). Use a customer number, not a shop's, for example the public demo buyer `9000000208`:

```sh
npm run mcp:build
npm run mcp:login -- --phone 9000000208   # prints only "logged in"
```

The login is saved in `apps/mcp-server/.askbuy-login.json` (git-ignored, readable only by you). To point at another server, set `ASKBUY_API_URL` (for example `http://localhost:3000`) for both commands and for the server.

2. Connect it. **Claude Code**, from the repository folder:

```sh
claude mcp add askbuy -- node "$(pwd)/apps/mcp-server/dist/main.js"
```

**Claude Desktop**: add this to `claude_desktop_config.json` (use your real path) and restart the app:

```json
{
  "mcpServers": {
    "askbuy": {
      "command": "node",
      "args": ["/absolute/path/to/askbuy/apps/mcp-server/dist/main.js"]
    }
  }
}
```

3. Try it. Demo shops answer by themselves on the live site. Ask:

- "Find milk near the demo location (22.7196, 75.8577) under ₹60."
- "Ask shops for chini near 22.7196, 75.8577 and tell me the cheapest."
- "Plan a route to the 3 cheapest shops from there."

`ask_shops` pings real shops, so your assistant should ask before using it; it should use `find_item_nearby` first. To look at the tools without an assistant: `npx @modelcontextprotocol/inspector node apps/mcp-server/dist/main.js`.
