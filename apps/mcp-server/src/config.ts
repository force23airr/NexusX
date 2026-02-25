// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Server Configuration
// apps/mcp-server/src/config.ts
// ═══════════════════════════════════════════════════════════════

import { z } from "zod";
import type { McpServerConfig } from "./types";

const configSchema = z.object({
  gatewayUrl: z.string().url().default("http://localhost:3100"),
  apiKey: z.string().optional().default(""),
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
  // ─── CDP Server Wallet ───
  cdpWalletPrivateKey: z.string().optional(), // Local EOA mode (simpler)
  cdpApiKeyName: z.string().optional(),        // CDP platform mode
  cdpApiKeyPrivateKey: z.string().optional(),  // CDP platform mode
  cdpWalletSecret: z.string().optional(),        // CDP v2 wallet secret
  cdpNetworkId: z.string().default("base-mainnet"),
  cdpWalletDataFile: z.string().default(".cdp-wallet.json"),
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
    cdpWalletPrivateKey: process.env.CDP_WALLET_PRIVATE_KEY,
    cdpApiKeyName: process.env.CDP_API_KEY_NAME,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    cdpWalletSecret: process.env.CDP_WALLET_SECRET,
    cdpNetworkId: process.env.CDP_NETWORK_ID,
    cdpWalletDataFile: process.env.CDP_WALLET_DATA_FILE,
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
