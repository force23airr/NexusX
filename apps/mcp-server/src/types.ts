// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Server Types
// apps/mcp-server/src/types.ts
// ═══════════════════════════════════════════════════════════════

/** MCP server configuration. */
export interface McpServerConfig {
  gatewayUrl: string;
  apiKey: string;
  transport: "stdio" | "http";
  httpPort: number;
  registryRefreshMs: number;
  sessionBudgetUsdc: number;
  sandbox: boolean;
  redisUrl: string;
  databaseUrl: string;
  debug: boolean;
}

/** A discovered listing ready for MCP tool registration. */
export interface DiscoveredListing {
  id: string;
  slug: string;
  name: string;
  description: string;
  listingType: string;
  categorySlug: string;
  tags: string[];
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  ceilingPriceUsdc: number | null;
  capacityPerMinute: number;
  qualityScore: number;
  avgLatencyMs: number;
  uptimePercent: number;
  sampleRequest: Record<string, unknown> | null;
  sampleResponse: Record<string, unknown> | null;
  schemaSpec: Record<string, unknown> | null;
  docsUrl: string | null;
  providerName: string;
}

/** Result of executing a tool through the gateway. */
export interface ToolExecutionResult {
  success: boolean;
  statusCode: number;
  body: string;
  priceUsdc: number;
  platformFeeUsdc: number;
  latencyMs: number;
  requestId: string;
  isSandbox: boolean;
}

/** Session-scoped budget state. */
export interface BudgetState {
  limitUsdc: number;
  spentUsdc: number;
  remainingUsdc: number;
  callCount: number;
  callLog: Array<{
    tool: string;
    priceUsdc: number;
    timestamp: number;
  }>;
}

/** Price tick from the Redis stream. */
export interface PriceTick {
  listingId: string;
  slug: string;
  name: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
}

/** Category tree node. */
export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  description: string;
  children: CategoryNode[];
  listingCount: number;
}

/** Wallet information for an agent. */
export interface WalletInfo {
  address: string;
  balanceUsdc: number;
  escrowUsdc: number;
}
