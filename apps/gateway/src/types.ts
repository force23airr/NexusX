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
  /** API key ID used for this request (empty string for x402 auth). */
  apiKeyId: string;
  /** Rate limit (requests per minute) for this key. */
  rateLimitRpm: number;
  /** Unique request ID for tracing. */
  requestId: string;
  /** Timestamp when the request entered the gateway. */
  receivedAt: number;
  /** ISO country code inferred from trusted ingress headers, if available. */
  callerCountry?: string | null;
  /** Macro region bucket inferred from callerCountry, if available. */
  callerRegionBucket?: string | null;
  /** Auth mode used for this request. */
  authMode?: "api_key" | "x402";
  /** Whether this request is in validated sandbox mode (set by middleware, not from raw header). */
  isSandbox?: boolean;
  /** x402 payment context, present when authMode is "x402" and settlement is complete. */
  x402?: X402PaymentContext;
  /** Deferred x402 payment proof — verified but not yet settled. Settled after upstream success. */
  x402DeferredPayment?: {
    paymentHeader: string;
    paymentRequirement: unknown; // PaymentRequirement from x402Adapter
    payerAddress: string;
    currentPriceUsdc: number;
    listingSlug: string;
    route: unknown; // ListingRoute snapshot
  };
}

/** Payment context from a verified x402 payment. */
export interface X402PaymentContext {
  /** Payer's wallet address (from x402 payment proof). */
  payerAddress: string;
  /** Total amount paid in USDC (includes platform fee). */
  amountUsdc: number;
  /** Platform fee portion in USDC. */
  platformFeeUsdc: number;
  /** Provider's share in USDC (amountUsdc - platformFeeUsdc). */
  providerAmountUsdc: number;
  /** On-chain transaction hash from facilitator settlement. */
  txHash: string;
  /** Network identifier (e.g. "eip155:8453"). */
  network: string;
  /** Listing slug this payment is for. */
  listingSlug: string;
  /** Unique request ID for tracing. */
  requestId: string;
  /** Timestamp when payment was received. */
  receivedAt: number;
}

export type X402ExecutionStatus =
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "UPSTREAM_FAILED"
  | "ABANDONED";

export interface X402ExecutionRecord {
  requestId: string;
  listingId: string;
  listingSlug: string;
  payerAddress: string;
  paymentHeaderHash: string;
  paymentHeader?: string | null;
  paymentRequirement: unknown;
  status: X402ExecutionStatus;
  quotedPriceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
  upstreamStatus?: number | null;
  responseTimeMs?: number | null;
  bytesTransferred?: number | null;
  txHash?: string | null;
  lastError?: string | null;
}

export type ExecutionReceiptOutcome =
  | "SUCCESS"
  | "FAILED"
  | "REJECTED";

export type ExecutionReceiptSettlementStatus =
  | "NONE"
  | "SETTLED"
  | "PENDING_RECONCILIATION"
  | "UPSTREAM_FAILED"
  | "DEFERRED_BUNDLE"
  | "ABANDONED";

export interface ExecutionReceiptRecord {
  requestId: string;
  queryLogId?: string | null;
  listingId?: string | null;
  operationId?: string | null;
  fallbackSourceReceiptId?: string | null;
  listingSlug: string;
  buyerId?: string | null;
  payerAddress?: string | null;
  callerCountry?: string | null;
  callerRegionBucket?: string | null;
  authMode: "API_KEY" | "X402";
  billingMode: "INDIVIDUAL" | "BUNDLE_STEP";
  outcome: ExecutionReceiptOutcome;
  settlementStatus: ExecutionReceiptSettlementStatus;
  sandbox?: boolean;
  quotedPriceUsdc?: number | null;
  chargedPriceUsdc?: number;
  platformFeeUsdc?: number;
  providerAmountUsdc?: number;
  httpStatus: number;
  upstreamStatus?: number | null;
  latencyMs?: number | null;
  bytesTransferred?: number | null;
  bundleSessionId?: string | null;
  bundleStepIndex?: number | null;
  txHash?: string | null;
  circuitState?: string | null;
  retryCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PersistedExecutionReceiptRef {
  id: string;
  requestId: string;
}

export interface ExecutionReceiptSignatureInput {
  requestId: string;
  listingId?: string | null;
  listingSlug: string;
  authMode: "API_KEY" | "X402";
  billingMode: "INDIVIDUAL" | "BUNDLE_STEP";
  outcome: ExecutionReceiptOutcome;
  settlementStatus: ExecutionReceiptSettlementStatus;
  quotedPriceUsdc: number;
  chargedPriceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
  httpStatus: number;
  upstreamStatus?: number | null;
  latencyMs: number;
  bytesTransferred?: number | null;
  txHash?: string | null;
  responseBody: Buffer;
}

export interface SignedExecutionReceipt {
  version: 1;
  algorithm: "ed25519";
  signer: string;
  responseHash: string;
  payloadHash: string;
  signature: string;
  payload: Record<string, unknown>;
}

/** Resolved listing details for proxying. */
export interface ListingRoute {
  listingId: string;
  slug: string;
  providerId: string;
  providerAddress: string;
  baseUrl: string;
  authType: string;
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  capacityPerMinute: number;
  status: string;
  isSandbox: boolean;

  // Discovery metadata (for Bazaar indexing via outputSchema)
  name?: string;
  description?: string;
  tags?: string[];
  sampleRequest?: Record<string, unknown> | null;
  sampleResponse?: Record<string, unknown> | null;
  sourceType?: string | null;
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
  status?: "PENDING" | "CONFIRMED" | "FAILED" | "REFUNDED" | "DISPUTED";
  billingMode?: "INDIVIDUAL" | "BUNDLE_STEP";
  bundleSessionId?: string | null;
  bundleStepIndex?: number | null;
  settledViaBundle?: boolean;
  priceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
  feeRateApplied: number;
  quotedPriceUsdc?: number | null;
  quotedPlatformFeeUsdc?: number | null;
  quotedProviderAmountUsdc?: number | null;
  responseTimeMs: number;
  httpStatus: number;
  bytesTransferred: number;
}

/** Bundle session registration payload from MCP executor. */
export interface BundleSessionRegistrationInput {
  buyerId: string;
  apiKeyId: string;
  bundleSlug: string;
  bundleName?: string | null;
  toolSlugs: string[];
  bundlePriceUsdc: number;
  bundlePlatformFeeRate: number;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

/** Stored bundle session summary used by proxy validation/finalization. */
export interface BundleSessionRecord {
  id: string;
  buyerId: string;
  apiKeyId: string | null;
  bundleSlug: string;
  bundleName: string | null;
  status: "REGISTERED" | "IN_PROGRESS" | "FINALIZED" | "FAILED" | "CANCELLED" | "EXPIRED";
  toolSlugs: string[];
  registeredGrossPriceUsdc: number;
  executedGrossPriceUsdc: number;
  targetBundlePriceUsdc: number;
  billedPriceUsdc: number;
  discountUsdc: number;
  platformFeeRate: number;
  platformFeeUsdc: number;
  providerPoolUsdc: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
}

export interface BundleSettlementAllocation {
  transactionId: string;
  listingId: string;
  listingSlug: string;
  providerId: string;
  bundleStepIndex: number;
  quotedPriceUsdc: number;
  weight: number;
  allocatedPriceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
}

export interface BundleSessionFinalizeResult {
  bundleSessionId: string;
  status: "FINALIZED";
  billedPriceUsdc: number;
  executedGrossPriceUsdc: number;
  discountUsdc: number;
  platformFeeUsdc: number;
  providerPoolUsdc: number;
  settlementCount: number;
  allocations: BundleSettlementAllocation[];
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
  /** Whether x402 payment protocol is enabled. */
  x402Enabled: boolean;
  /** x402 facilitator URL for payment verification/settlement. */
  x402FacilitatorUrl: string;
  /** x402 network identifier (e.g. "eip155:8453" for Base mainnet). */
  x402Network: string;
  /** Platform wallet address that receives x402 payments (fee split happens off-chain). */
  x402PlatformAddress: string;
  /** Platform fee rate to apply for settled bundle executions. */
  bundlePlatformFeeRate: number;
  /** Time-to-live for bundle execution sessions before expiry. */
  bundleSessionTtlMs: number;
  /** Whether to fail fast on repeatedly failing upstreams. */
  circuitBreakerEnabled: boolean;
  /** Number of consecutive upstream 5xx responses before opening the circuit. */
  circuitBreakerFailureThreshold: number;
  /** Cooldown period before allowing a half-open probe request. */
  circuitBreakerCooldownMs: number;
  /** Auth failures from one client before temporary shared blocking. */
  authAbuseThreshold: number;
  /** Auth abuse rolling window in milliseconds. */
  authAbuseWindowMs: number;
  /** Auth abuse block duration in milliseconds. */
  authAbuseBlockMs: number;
  /** Payment abuse events from one client before temporary shared blocking. */
  paymentAbuseThreshold: number;
  /** Payment abuse rolling window in milliseconds. */
  paymentAbuseWindowMs: number;
  /** Payment abuse block duration in milliseconds. */
  paymentAbuseBlockMs: number;
  /** Whether to sign execution receipts for agent-side verification. */
  receiptSigningEnabled: boolean;
  /** Stable signer identifier exposed in receipt headers. */
  receiptSignerId: string;
  /** PEM-encoded Ed25519 private key used to sign receipt payload hashes. */
  receiptSigningPrivateKeyPem: string;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 3100,
  upstreamTimeoutMs: 30_000,
  maxBodySizeBytes: 10 * 1024 * 1024, // 10 MB
  platformFeeRate: 0.12,
  redisUrl: "redis://localhost:6379",
  sandboxEnabled: false,
  routeCacheTtlMs: 60_000,         // 1 minute
  healthCheckIntervalMs: 300_000,  // 5 minutes
  x402Enabled: false,
  x402FacilitatorUrl: "https://x402.org/facilitator",
  x402Network: "eip155:84532",     // Base Sepolia (dev default)
  x402PlatformAddress: "",         // Must be set when x402Enabled=true
  bundlePlatformFeeRate: 0.15,
  bundleSessionTtlMs: 30 * 60 * 1000,
  circuitBreakerEnabled: true,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerCooldownMs: 30_000,
  authAbuseThreshold: 12,
  authAbuseWindowMs: 5 * 60 * 1000,
  authAbuseBlockMs: 15 * 60 * 1000,
  paymentAbuseThreshold: 4,
  paymentAbuseWindowMs: 10 * 60 * 1000,
  paymentAbuseBlockMs: 30 * 60 * 1000,
  receiptSigningEnabled: false,
  receiptSignerId: "nexusx-gateway",
  receiptSigningPrivateKeyPem: "",
};
