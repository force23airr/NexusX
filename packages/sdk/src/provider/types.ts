// ═══════════════════════════════════════════════════════════════
// NexusX — Provider SDK Types
// packages/sdk/src/provider/types.ts
//
// Type definitions for the provider-facing SDK. Covers:
//   - Client configuration
//   - Listing registration & management
//   - Health metric reporting
//   - Webhook event handling
//   - Payout management
//   - Provider profile management
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// CLIENT CONFIGURATION
// ─────────────────────────────────────────────────────────────

/** SDK client configuration. */
export interface NexusXProviderConfig {
  /** NexusX platform API base URL. */
  baseUrl: string;
  /** Provider API key (format: nxs_prov_{...}). */
  apiKey: string;
  /** Request timeout in milliseconds. Default: 10_000. */
  timeoutMs?: number;
  /** Number of retries on transient failures. Default: 3. */
  retries?: number;
  /** Retry backoff base in ms. Default: 500. */
  retryBackoffMs?: number;
  /** Custom headers to include on every request. */
  headers?: Record<string, string>;
  /** Enable debug logging. Default: false. */
  debug?: boolean;
}

export const DEFAULT_PROVIDER_CONFIG: Required<
  Pick<NexusXProviderConfig, "timeoutMs" | "retries" | "retryBackoffMs" | "debug">
> = {
  timeoutMs: 10_000,
  retries: 3,
  retryBackoffMs: 500,
  debug: false,
};

// ─────────────────────────────────────────────────────────────
// PROVIDER PROFILE
// ─────────────────────────────────────────────────────────────

/** Provider profile as returned by the platform. */
export interface ProviderProfile {
  id: string;
  userId: string;
  companyName: string | null;
  website: string | null;
  description: string | null;
  totalRevenue: string;
  totalPayouts: string;
  pendingBalance: string;
  payoutAddress: string | null;
  autoPayoutEnabled: boolean;
  autoPayoutThreshold: string;
  createdAt: string;
}

/** Fields that can be updated on a provider profile. */
export interface UpdateProfileInput {
  companyName?: string;
  website?: string;
  description?: string;
  payoutAddress?: string;
  autoPayoutEnabled?: boolean;
  /** Minimum USDC balance to trigger auto-payout. */
  autoPayoutThreshold?: number;
}

// ─────────────────────────────────────────────────────────────
// LISTING REGISTRATION
// ─────────────────────────────────────────────────────────────

/** Supported listing types. */
export type ListingType =
  | "REST_API"
  | "GRAPHQL_API"
  | "WEBSOCKET"
  | "DATASET"
  | "MODEL_INFERENCE"
  | "COMPOSITE";

/** Auth methods for upstream provider endpoints. */
export type AuthType =
  | "api_key"
  | "bearer_token"
  | "basic_auth"
  | "oauth2"
  | "none";

export type ListingRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ListingSideEffectLevel = "READ_ONLY" | "REVERSIBLE" | "IRREVERSIBLE";
export type ListingOperationMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ListingReadinessSnapshot {
  score: number;
  readyForActivation: boolean;
  issues: string[];
  warnings: string[];
  updatedAt: string | null;
}

export interface ListingOperationContract {
  operationId: string;
  name: string;
  description: string;
  method: ListingOperationMethod;
  path: string;
  mode: string;
  authScheme: string | null;
  idempotent: boolean;
  sideEffect: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  sampleInput?: Record<string, unknown> | null;
  sampleOutput?: Record<string, unknown> | null;
}

export interface DiscoveryMetadata {
  /** Broad search tags used during discovery. */
  tags?: string[];
  /** Concrete tasks an agent can complete with this API. */
  intents?: string[];
  /** ISO country codes where the API is available. Empty means global. */
  availabilityRegions?: string[];
  /** ISO country codes where the API must not be surfaced. */
  restrictedRegions?: string[];
  /** Compliance or policy tags. */
  complianceTags?: string[];
  /** Capability tags used for hard filtering. */
  capabilityTags?: string[];
  /** Modalities the API accepts. */
  inputModalities?: string[];
  /** Modalities the API returns. */
  outputModalities?: string[];
  /** Optional vertical-specific metadata. */
  domainMetadata?: Record<string, unknown> | null;
  /** Supported upstream auth schemes. */
  authSchemes?: string[];
  /** Execution patterns supported by the API. */
  interactionModes?: string[];
  /** Require explicit human approval before high-risk execution. */
  humanApprovalRequired?: boolean;
  /** Explicitly opt out of health probing if no stable health endpoint exists. */
  noHealthProbe?: boolean;
  /** Provider-declared risk level. */
  riskLevel?: ListingRiskLevel;
  /** Side-effect level of the exposed operations. */
  sideEffectLevel?: ListingSideEffectLevel;
}

/** Input for creating a new listing. */
export interface CreateListingInput extends DiscoveryMetadata {
  /** URL-friendly slug (must be unique). */
  slug: string;
  /** Display name. */
  name: string;
  /** Detailed description (markdown supported). */
  description: string;
  /** Category slug from the taxonomy (e.g. "nlp", "translation"). */
  categorySlug: string;
  /** Listing type. */
  listingType: ListingType;

  // ─── Endpoint Configuration ───
  /** Base URL of your API endpoint. */
  baseUrl: string;
  /** Health check URL (GET, expect 200). Optional. */
  healthCheckUrl?: string;
  /** API documentation URL. Optional. */
  docsUrl?: string;
  /** Sandbox/test endpoint URL. Optional. */
  sandboxUrl?: string;
  /** Authentication method for your endpoint. Default: "api_key". */
  authType?: AuthType;

  // ─── Pricing ───
  /** Minimum price per call in USDC. */
  floorPriceUsdc: number;
  /** Maximum price per call in USDC. Optional (uncapped if omitted). */
  ceilingPriceUsdc?: number;

  // ─── Capacity ───
  /** Maximum requests per minute your endpoint can handle. Default: 60. */
  capacityPerMinute?: number;
  /** Whether this is a unique/exclusive listing. Default: false. */
  isUnique?: boolean;

  /** Example request payload (JSON). */
  sampleRequest?: Record<string, unknown>;
  /** Example response payload (JSON). */
  sampleResponse?: Record<string, unknown>;
  /** OpenAPI/JSON Schema spec (JSON). */
  schemaSpec?: Record<string, unknown>;
  /** Structured action contracts agents can call directly. */
  operationContracts?: ListingOperationContract[];
}

/** Input for updating an existing listing. All fields optional. */
export interface UpdateListingInput extends DiscoveryMetadata {
  name?: string;
  description?: string;
  categorySlug?: string;
  baseUrl?: string;
  healthCheckUrl?: string | null;
  docsUrl?: string | null;
  sandboxUrl?: string | null;
  authType?: AuthType;
  floorPriceUsdc?: number;
  ceilingPriceUsdc?: number | null;
  capacityPerMinute?: number;
  isUnique?: boolean;
  tags?: string[];
  sampleRequest?: Record<string, unknown> | null;
  sampleResponse?: Record<string, unknown> | null;
  schemaSpec?: Record<string, unknown> | null;
  operationContracts?: ListingOperationContract[] | null;
}

/** Listing as returned by the platform. */
export interface Listing {
  id: string;
  slug: string;
  name: string;
  description: string;
  listingType: ListingType;
  status: string;
  categorySlug: string;
  baseUrl: string;
  healthCheckUrl: string | null;
  docsUrl: string | null;
  sandboxUrl: string | null;
  authType: string;
  authSchemes: string[];
  interactionModes: string[];
  humanApprovalRequired: boolean;
  noHealthProbe: boolean;
  riskLevel: ListingRiskLevel;
  sideEffectLevel: ListingSideEffectLevel;
  floorPriceUsdc: string;
  ceilingPriceUsdc: string | null;
  currentPriceUsdc: string;
  capacityPerMinute: number;
  isUnique: boolean;
  tags: string[];
  intents: string[];
  availabilityRegions: string[];
  restrictedRegions: string[];
  complianceTags: string[];
  capabilityTags: string[];
  inputModalities: string[];
  outputModalities: string[];
  domainMetadata: Record<string, unknown> | null;
  sampleRequest?: Record<string, unknown> | null;
  sampleResponse?: Record<string, unknown> | null;
  schemaSpec?: Record<string, unknown> | null;
  operationContracts?: ListingOperationContract[];
  totalCalls: string;
  totalRevenue: string;
  avgRating: string;
  ratingCount: number;
  readiness: ListingReadinessSnapshot;
  publishedAt: string | null;
  createdAt: string;
  updatedAt?: string;
}

// ─────────────────────────────────────────────────────────────
// HEALTH METRIC REPORTING
// ─────────────────────────────────────────────────────────────

/** Health metrics payload reported by the provider. */
export interface HealthMetricReport {
  /** Listing ID or slug. */
  listingIdOrSlug: string;
  /** Successful requests in this period. */
  successCount: number;
  /** Failed requests in this period. */
  failureCount: number;
  /** Median response time in milliseconds. */
  medianLatencyMs: number;
  /** P99 response time in milliseconds. */
  p99LatencyMs: number;
  /** Minutes the endpoint was up in this period. */
  uptimeMinutes: number;
  /** Total minutes in the reporting period. */
  totalMinutes: number;
  /** Period start (ISO datetime). */
  periodStart: string;
  /** Period end (ISO datetime). */
  periodEnd: string;
}

/** Auto-reporter configuration for background health reporting. */
export interface HealthReporterConfig {
  /** Listing ID or slug to report for. */
  listingIdOrSlug: string;
  /** Reporting interval in milliseconds. Default: 300_000 (5 min). */
  intervalMs?: number;
  /** Health check URL to probe. If omitted, uses listing's healthCheckUrl. */
  healthCheckUrl?: string;
  /** Timeout for health probes in ms. Default: 5000. */
  probeTimeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────
// WEBHOOKS
// ─────────────────────────────────────────────────────────────

/** Webhook event types the platform can send to providers. */
export type WebhookEventType =
  | "listing.activated"
  | "listing.suspended"
  | "listing.paused"
  | "transaction.completed"
  | "transaction.refunded"
  | "payout.completed"
  | "payout.failed"
  | "price.updated"
  | "rating.received"
  | "subscription.created"
  | "subscription.cancelled"
  | "demand.spike"
  | "quality.degraded";

/** Webhook registration input. */
export interface RegisterWebhookInput {
  /** HTTPS endpoint to receive events. */
  url: string;
  /** Event types to subscribe to. */
  events: WebhookEventType[];
  /** Shared secret for HMAC-SHA256 signature verification. */
  secret: string;
  /** Optional description/label. */
  description?: string;
}

/** Webhook as returned by the platform. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventType[];
  isActive: boolean;
  description: string | null;
  lastDeliveredAt: string | null;
  failureCount: number;
  createdAt: string;
}

/** Incoming webhook payload structure. */
export interface WebhookPayload<T = unknown> {
  /** Event ID (for idempotency). */
  eventId: string;
  /** Event type. */
  type: WebhookEventType;
  /** ISO timestamp. */
  timestamp: string;
  /** Event-specific data. */
  data: T;
}

// ─────────────────────────────────────────────────────────────
// PAYOUTS
// ─────────────────────────────────────────────────────────────

/** Payout record. */
export interface Payout {
  id: string;
  status: string;
  amountUsdc: string;
  destinationAddr: string;
  txHash: string | null;
  chainId: number;
  initiatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
}

/** Request a manual payout. */
export interface RequestPayoutInput {
  /** Amount in USDC. Must be ≤ pendingBalance. */
  amountUsdc: number;
  /** Destination wallet address. Defaults to profile payoutAddress. */
  destinationAddr?: string;
}

// ─────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────

/** Listing analytics summary. */
export interface ListingAnalytics {
  listingId: string;
  period: string;
  totalCalls: number;
  totalRevenueUsdc: string;
  platformFeesUsdc: string;
  uniqueBuyers: number;
  avgLatencyMs: number;
  errorRate: number;
  avgRating: number;
  currentPriceUsdc: string;
  demandScore: number;
  qualityScore: number;
}

// ─────────────────────────────────────────────────────────────
// API RESPONSE WRAPPER
// ─────────────────────────────────────────────────────────────

/** Standard API response envelope. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  requestId?: string;
}

/** Paginated list response. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
