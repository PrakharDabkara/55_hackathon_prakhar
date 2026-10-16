import { z } from 'zod';
import {
  askShopsTool,
  closeRequestTool,
  findItemNearbyTool,
  getRequestStatusTool,
  planRouteTool,
  resolveItemTool,
  type ToolDefinition,
} from './definitions.js';

export type { ToolDefinition } from './definitions.js';
export {
  askShopsTool,
  closeRequestTool,
  findItemNearbyTool,
  getRequestStatusTool,
  planRouteTool,
  REQUEST_STATES,
  resolveItemTool,
} from './definitions.js';

/** Every tool, in the order an errand uses them. */
export const tools = [
  resolveItemTool,
  findItemNearbyTool,
  askShopsTool,
  getRequestStatusTool,
  closeRequestTool,
  planRouteTool,
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof tools)[number]['name'];

export function toolByName(name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool as ToolDefinition;
}

/** The tool as plain JSON Schema: what MCP lists and what Gemini function declarations are built from. */
export function toJsonSchema(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input) as Record<string, unknown>,
    outputSchema: z.toJSONSchema(tool.output) as Record<string, unknown>,
  };
}
