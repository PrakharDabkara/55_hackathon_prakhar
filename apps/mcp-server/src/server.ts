import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tools } from '@askbuy/shared/tools';
import type { ApiClient } from './apiClient.js';
import { runTool, ToolError } from './handlers.js';

export const INSTRUCTIONS = `KahanMilega finds which nearby shops have an item and at what price. The shops answer a one-tap ping; answers are remembered and fade as they age.

Errand workflow:
1. resolve_item: turn what the user said into an item. If it returns a clarification, ask the user and try again.
2. find_item_nearby: shops that already confirmed the item. This is instant and contacts nobody. If 3 or more are fresh (freshCount), answer from it.
3. ask_shops: only if fewer than 3 are fresh. This pings real shops, so use it once per need (pass an idempotencyKey).
4. get_request_status: poll every 10 to 20 seconds while pingStats.pending is above 0. Results come cheapest first.
5. close_request when you have enough answers or the user is done.
6. plan_route: when the user wants to visit several shops (up to 8).
Prices are in paise (100 paise = 1 rupee). Distances are straight-line metres.`;

/** The MCP server: the shared tool registry, each tool run against the public API with the user's own token. */
export function createMcpServer({ api }: { api: ApiClient }): McpServer {
  const server = new McpServer(
    { name: 'kahanmilega', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
        annotations: {
          title: tool.title,
          readOnlyHint: !tool.sideEffects,
          // Nothing here deletes data; ask_shops pings shops but destroys nothing.
          destructiveHint: false,
          idempotentHint: tool.idempotent,
          openWorldHint: true,
        },
      },
      async (input: unknown) => {
        try {
          const output = (await runTool(tool.name, input, api)) as Record<string, unknown>;
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          if (error instanceof ToolError) {
            return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
          }
          throw error;
        }
      },
    );
  }
  return server;
}
