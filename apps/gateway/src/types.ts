// ═══════════════════════════════════════════════════════════════
// NexusX — Gateway Types
// apps/gateway/src/types.ts
//
// Shared types for the API gateway proxy layer.
// ═══════════════════════════════════════════════════════════════

/** Authenticated request context attached after API key validation. */
export interface RequestContext {
  /** Buyer's user ID (UUID). */
  buyerId: string;
  /** Buyer's wallet address on Base L2. */
  buyerAddress: string;
  /** API key ID used for this request. */
  apiKeyId: string;
  /** Rate limit (requests per minute) for this key. */
  rateLimitRpm: number;
  /** Unique request ID for tracing. */
  requestId: string;
  /** Timestamp when the request entered the gateway. */
  receivedAt: number;
}

/** Resolved listing details for proxying. */
export interface ListingRoute {
  listingId: string;
  providerId: string;
  providerAddress: string;
  baseUrl: string;
  authType: string;
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  capacityPerMinute: number;
  status: string;
  isSandbox: boolean;
}

/** Upstream proxy response. */
export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  latencyMs: number;
  bytesTransferred: number;
}

/** Transaction record to be persisted after a successful call. */
export interface TransactionRecord {
  requestId: string;
  listingId: string;
  buyerId: string;
  priceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
  feeRateApplied: number;
  responseTimeMs: number;
  httpStatus: number;
  bytesTransferred: number;
}

/** Demand signal to be emitted to the auction engine. */
export interface DemandSignalEvent {
  listingId: string;
  buyerId: string;
  type: string;
  weight: number;
  metadata?: Record<string, unknown>;
}

/** Rate limiter entry. */
export interface RateLimitState {
  count: number;
  windowStart: number;
}

/** Gateway configuration. */
export interface GatewayConfig {
  /** Port to listen on. */
  port: number;
  /** Upstream request timeout in milliseconds. */
  upstreamTimeoutMs: number;
  /** Maximum request body size in bytes. */
  maxBodySizeBytes: number;
  /** Platform fee rate (0.12 = 12%). Synced from PricingConfig. */
  platformFeeRate: number;
  /** Redis URL for rate limiting and caching. */
  redisUrl: string;
  /** Whether to enable sandbox mode (no billing). */
  sandboxEnabled: boolean;
  /** How long to cache listing routes (ms). */
  routeCacheTtlMs: number;
  /** Health check interval for upstream providers (ms). */
  healthCheckIntervalMs: number;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 3100,
  upstreamTimeoutMs: 30_000,
  maxBodySizeBytes: 10 * 1024 * 1024, // 10 MB
  platformFeeRate: 0.12,
  redisUrl: "redis://localhost:6379",
  sandboxEnabled: true,
  routeCacheTtlMs: 60_000,         // 1 minute
  healthCheckIntervalMs: 300_000,  // 5 minutes
};
