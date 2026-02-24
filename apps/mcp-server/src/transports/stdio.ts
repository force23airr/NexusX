// ═══════════════════════════════════════════════════════════════
// NexusX — MCP stdio Transport
// apps/mcp-server/src/transports/stdio.ts
//
// Wraps StdioServerTransport for local agent use (Claude Desktop).
// ═══════════════════════════════════════════════════════════════

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Connect the MCP server to stdin/stdout transport.
 * Used when the server runs as a child process of an AI agent.
 */
export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Connected via stdio transport.");
}
