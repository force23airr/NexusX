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

/** Input for creating a new listing. */
export interface CreateListingInput {
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

  // ─── Discovery ───
  /** Tags for search and filtering. */
  tags?: string[];
  /** Example request payload (JSON). */
  sampleRequest?: Record<string, unknown>;
  /** Example response payload (JSON). */
  sampleResponse?: Record<string, unknown>;
  /** OpenAPI/JSON Schema spec (JSON). */
  schemaSpec?: Record<string, unknown>;
}

/** Input for updating an existing listing. All fields optional. */
export interface UpdateListingInput {
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
  floorPriceUsdc: string;
  ceilingPriceUsdc: string | null;
  currentPriceUsdc: string;
  capacityPerMinute: number;
  isUnique: boolean;
  tags: string[];
  totalCalls: string;
  totalRevenue: string;
  avgRating: string;
  ratingCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
