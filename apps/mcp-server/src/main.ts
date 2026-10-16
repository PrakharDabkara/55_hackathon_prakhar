import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHttpApiClient } from './apiClient.js';
import { resolveConfig } from './config.js';
import { createMcpServer } from './server.js';
import { loadToken } from './tokenStore.js';

// stdio MCP server. Stdout carries the protocol, so anything for a human goes to stderr.
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = resolveConfig(process.env, packageDir);

const server = createMcpServer({
  api: createHttpApiClient({
    baseUrl: config.apiUrl,
    // Read on every call, so a fresh `npm run mcp:login` works without a restart.
    getToken: () => loadToken(config.tokenFile)?.token ?? null,
  }),
});

await server.connect(new StdioServerTransport());
console.error(`kahanmilega MCP server ready (API ${config.apiUrl})`);
