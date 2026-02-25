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

/** One step inside a composite bundle. */
export interface BundleStep {
  listingId: string;
  slug: string;
  name: string;
  categorySlug: string;
  currentPriceUsdc: number;
  qualityScore: number;
}

/** Generated composite bundle tool (virtual marketplace offering). */
export interface BundleDefinition {
  id: string;
  slug: string;
  toolName: string;
  name: string;
  description: string;
  steps: BundleStep[];
  grossPriceUsdc: number;
  discountPct: number;
  bundlePriceUsdc: number;
  qualityScore: number;
  semanticCohesion: number;
  patternSupport: number;
  score: number;
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
  billingMode?: "individual" | "bundle_step";
  quotedPriceUsdc?: number;
  bundleSessionId?: string;
  bundleStepIndex?: number;
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

/** Price tick from the Redis stream (enriched with multiplier data). */
export interface PriceTick {
  listingId: string;
  slug: string;
  name: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  timestamp?: number;
  multipliers?: PriceMultipliers;
  demandScore?: number;
  demandVelocity?: number;
}

/** Multiplier breakdown from the pricing engine. */
export interface PriceMultipliers {
  demand: number;
  scarcity: number;
  quality: number;
  momentum: number;
  temporal: number;
  combined: number;
}

/** A single point in price history. */
export interface PriceHistoryPoint {
  price: number;
  timestamp: number;
  multipliers?: PriceMultipliers;
  demandScore?: number;
  demandVelocity?: number;
}

/** Computed trajectory analysis for agent decision-making. */
export interface PriceTrajectory {
  direction: "rising_fast" | "rising" | "stable" | "falling" | "falling_fast";
  priceChange5m: number;
  priceChange15m: number;
  priceChange1h: number;
  demandTrend: "accelerating" | "stable" | "decelerating";
  velocityAvg: number;
  support: number;
  resistance: number;
  recommendation: string;
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
