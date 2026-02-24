// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Server Configuration
// apps/mcp-server/src/config.ts
// ═══════════════════════════════════════════════════════════════

import { z } from "zod";
import type { McpServerConfig } from "./types";

const configSchema = z.object({
  gatewayUrl: z.string().url().default("http://localhost:3100"),
  apiKey: z.string().min(1, "NEXUSX_API_KEY is required"),
  transport: z.enum(["stdio", "http"]).default("stdio"),
  httpPort: z.coerce.number().int().positive().default(3400),
  registryRefreshMs: z.coerce.number().int().positive().default(60_000),
  sessionBudgetUsdc: z.coerce.number().min(0).default(0),
  sandbox: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  redisUrl: z.string().default("redis://localhost:6379"),
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  debug: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export function loadConfig(): McpServerConfig {
  const raw = {
    gatewayUrl: process.env.NEXUSX_GATEWAY_URL,
    apiKey: process.env.NEXUSX_API_KEY,
    transport: process.env.NEXUSX_TRANSPORT,
    httpPort: process.env.MCP_PORT,
    registryRefreshMs: process.env.NEXUSX_REGISTRY_REFRESH_MS,
    sessionBudgetUsdc: process.env.NEXUSX_SESSION_BUDGET_USDC,
    sandbox: process.env.NEXUSX_SANDBOX,
    redisUrl: process.env.REDIS_URL,
    databaseUrl: process.env.DATABASE_URL,
    debug: process.env.NEXUSX_DEBUG,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[MCP] Invalid configuration:\n${errors}`);
  }

  return result.data as McpServerConfig;
}
