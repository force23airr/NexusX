// ═══════════════════════════════════════════════════════════════
// NexusX — Agent SDK Types
// packages/sdk/src/agent/types.ts
//
// Self-contained type definitions for the agent-facing SDK.
// No imports from provider types — keeps the module tree-shakeable.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────

export interface NexusXAgentConfig {
  /** Gateway base URL (e.g., "https://gateway.nexusx.ai"). Required. */
  gatewayUrl: string;

  /** Web app base URL for search/discovery (e.g., "https://app.nexusx.ai"). Optional. */
  webUrl?: string;

  /** API key for Bearer auth mode (format: nxs_{env}_{hash}). */
  apiKey?: string;

  /** Wallet signer for x402 autonomous payment mode. */
  wallet?: WalletSigner;

  /** Session spending limit in USDC. 0 = unlimited. Default: 0. */
  budgetUsdc?: number;

  /** Request timeout in ms. Default: 30_000. */
  timeoutMs?: number;

  /** Enable sandbox mode (X-NexusX-Sandbox: true). Default: false. */
  sandbox?: boolean;

  /** Enable debug logging to console.error. Default: false. */
  debug?: boolean;
}

// ─────────────────────────────────────────────────────────────
// WALLET SIGNER
// ─────────────────────────────────────────────────────────────

/** x402 payment requirements from a 402 response. */
export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  resource?: string;
  description?: string;
  extra?: { name: string; version: string };
}

/** Pluggable signer. Implement this to use any wallet (viem, CDP SDK, hardware, MPC). */
export interface WalletSigner {
  /** Build the base64-encoded X-Payment header for x402. */
  buildPaymentHeader(req: X402PaymentRequirements): Promise<string>;
  /** Returns the wallet address. */
  getAddress(): string;
}

// ─────────────────────────────────────────────────────────────
// CALL PARAMETERS & RESULT
// ─────────────────────────────────────────────────────────────

export interface CallParams {
  /** HTTP method. Default: "POST". */
  method?: string;
  /** Request body (will be JSON.stringify'd). */
  body?: unknown;
  /** Query string parameters. */
  query?: Record<string, string>;
  /** Search query ID to correlate discovery-to-execution conversion. */
  queryId?: string;
  /** Extra headers. */
  headers?: Record<string, string>;
}

export interface CallResult {
  /** True if HTTP status is 2xx or 3xx. */
  success: boolean;
  /** HTTP status code from upstream. */
  statusCode: number;
  /** Parsed response body (JSON object if parseable, else raw string). */
  data: unknown;
  /** Raw response body string. */
  raw: string;
  /** Price charged in USDC (0 if sandbox or free). */
  priceUsdc: number;
  /** Quoted price in USDC (differs from charged price for bundle-step calls). */
  quotedPriceUsdc: number;
  /** Platform fee captured in the execution receipt. */
  platformFeeUsdc: number;
  /** Provider amount captured in the execution receipt. */
  providerAmountUsdc: number;
  /** Upstream latency reported by gateway, in ms. */
  latencyMs: number;
  /** Gateway request ID for tracing. */
  requestId: string;
  /** Gateway billing mode for this execution. */
  billingMode: "individual" | "bundle_step";
  /** Settlement status reported by the gateway. */
  settlementStatus: "none" | "settled" | "pending_reconciliation" | "upstream_failed" | "deferred_bundle" | "abandoned";
  /** Normalized failure class for degraded/error responses. */
  failureClass?: string;
  /** Whether the gateway considers this result retryable. */
  retryable?: boolean;
  /** Billing decision applied by the gateway for this execution. */
  billingDecision?: "not_charged" | "charged" | "charged_pending_settlement" | "deferred_bundle";
  /** True when the gateway executed in validated sandbox mode. */
  isSandbox: boolean;
  /** Typed execution receipt summary returned by the gateway. */
  receipt: ExecutionReceiptSummary | null;
}

export interface ExecutionReceiptSummary {
  id: string;
  requestId: string;
  queryId?: string;
  listingSlug: string;
  authMode: "api_key" | "x402";
  billingMode: "individual" | "bundle_step";
  outcome: "success" | "failed" | "rejected";
  settlementStatus: "none" | "settled" | "pending_reconciliation" | "upstream_failed" | "deferred_bundle" | "abandoned";
  failureClass?: string;
  retryable?: boolean;
  billingDecision?: "not_charged" | "charged" | "charged_pending_settlement" | "deferred_bundle";
  priceUsdc: number;
  quotedPriceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
  latencyMs: number;
  statusCode: number;
  sandbox: boolean;
  txHash?: string;
  bundleSessionId?: string;
  bundleStepIndex?: number;
  circuitState?: string;
}

// ─────────────────────────────────────────────────────────────
// CHAIN
// ─────────────────────────────────────────────────────────────

export interface ChainStep {
  /** Listing slug. */
  slug: string;
  /** Upstream path. Default: "/". */
  path?: string;
  /** HTTP method. Default: "POST". */
  method?: string;
  /** Request body. If omitted on steps 2+, auto-filled from previous step output. */
  body?: unknown;
  /** Query string parameters. */
  query?: Record<string, string>;
  /** Extra headers. */
  headers?: Record<string, string>;
}

export interface ChainResult {
  /** True if all steps succeeded. */
  success: boolean;
  /** Array of per-step results. */
  steps: Array<CallResult & { slug: string; stepIndex: number }>;
  /** Total USDC spent across all steps. */
  totalPriceUsdc: number;
  /** Total latency across all steps in ms. */
  totalLatencyMs: number;
}

// ─────────────────────────────────────────────────────────────
// DISCOVERY
// ─────────────────────────────────────────────────────────────

export interface SearchMatch {
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  queryId?: string;
  currentPriceUsdc: number;
  qualityScore: number;
  trustScore?: number;
  trustState?: "trusted" | "degraded" | "high_risk" | "unproven";
  regionAffinityScore?: number;
  score: number;
  matchReasons: string[];
}

export interface SearchMetadataFilters {
  availabilityRegion?: string;
  complianceRequired?: string[];
  capabilityRequired?: string[];
  inputModality?: string[];
  outputModality?: string[];
  listingType?: string;
  maxPriceUsdc?: number;
  minCapacityRpm?: number;
}

export interface SearchOptions {
  limit?: number;
  priorityMode?: "frugal" | "balanced" | "mission_critical";
  metadataFilters?: SearchMetadataFilters;
}

export interface SearchResult {
  queryId?: string;
  matches: SearchMatch[];
  totalEvaluated: number;
  routeTimeMs: number;
  suggestions: string[];
}

export interface PricingInfo {
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  platformFee: number;
  providerAmount: number;
  feeRate: number;
}

export interface ReliabilityInfo {
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  uptimePct: number;
  callCount: number;
  qualityScore: number;
  computedAt: number;
}

// ─────────────────────────────────────────────────────────────
// BUDGET
// ─────────────────────────────────────────────────────────────

export interface BudgetState {
  limitUsdc: number;
  spentUsdc: number;
  remainingUsdc: number;
  callCount: number;
}
