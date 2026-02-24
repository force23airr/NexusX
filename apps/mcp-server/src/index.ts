// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Server Entry Point
// apps/mcp-server/src/index.ts
//
// Bootstraps the MCP server:
//   1. Load configuration from environment
//   2. Connect to database
//   3. Create MCP server with tools, resources, prompts
//   4. Start the selected transport (stdio or HTTP)
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config";
import { createMcpServer } from "./server";
import { startStdioTransport } from "./transports/stdio";
import { startHttpTransport } from "./transports/http";

async function main(): Promise<void> {
  const config = loadConfig();

  // Use stderr for logging (stdout is reserved for stdio transport)
  console.error("[MCP] NexusX MCP Server starting...");
  console.error(`[MCP] Transport: ${config.transport}`);
  console.error(`[MCP] Gateway: ${config.gatewayUrl}`);
  console.error(`[MCP] Sandbox: ${config.sandbox}`);
  if (config.sessionBudgetUsdc > 0) {
    console.error(`[MCP] Session budget: $${config.sessionBudgetUsdc} USDC`);
  }

  const prisma = new PrismaClient({
    datasourceUrl: config.databaseUrl,
    log: config.debug ? ["query", "warn", "error"] : ["warn", "error"],
  });

  const { server, cleanup } = await createMcpServer(config, prisma);

  // ─── Start Transport ───
  if (config.transport === "stdio") {
    await startStdioTransport(server);
  } else {
    await startHttpTransport(server, config.httpPort);
  }

  // ─── Graceful Shutdown ───
  const shutdown = async (signal: string) => {
    console.error(`[MCP] Received ${signal}. Shutting down...`);
    await cleanup();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
