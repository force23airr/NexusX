// ═══════════════════════════════════════════════════════════════
// NexusX — Frontend Types
// apps/web/src/types/index.ts
//
// Client-side type definitions mirroring the backend schemas.
// Used by all components and API client hooks.
// ═══════════════════════════════════════════════════════════════

// ─── Enums ───

export type UserRole = "PROVIDER" | "BUYER" | "ADMIN";
export type ListingType = "REST_API" | "GRAPHQL_API" | "WEBSOCKET" | "DATASET" | "MODEL_INFERENCE" | "COMPOSITE";
export type ListingStatus = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "DEPRECATED";
export type ListingRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ListingSideEffectLevel = "READ_ONLY" | "REVERSIBLE" | "IRREVERSIBLE";
export type ListingOperationMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type TransactionStatus = "PENDING" | "CONFIRMED" | "FAILED" | "REFUNDED" | "DISPUTED";
export type SearchPriorityMode = "frugal" | "balanced" | "mission_critical";

export interface ListingDiscoveryMetadata {
  tags?: string[];
  intents?: string[];
  availabilityRegions?: string[];
  restrictedRegions?: string[];
  complianceTags?: string[];
  capabilityTags?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  domainMetadata?: Record<string, unknown> | null;
}

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
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  sampleInput: Record<string, unknown> | null;
  sampleOutput: Record<string, unknown> | null;
}

export interface SearchMetadataFilters {
  availabilityRegion?: string;
  complianceRequired?: string[];
  capabilityRequired?: string[];
  inputModality?: string[];
  outputModality?: string[];
  listingType?: ListingType;
  maxPriceUsdc?: number;
  minCapacityRpm?: number;
}

export interface MarketplaceSearchOptions {
  limit?: number;
  priorityMode?: SearchPriorityMode;
  metadataFilters?: SearchMetadataFilters;
}

// ─── User & Auth ───

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  roles: UserRole[];
  kycStatus: string;
  createdAt: string;
}

// ─── Listings ───

export interface Listing extends ListingDiscoveryMetadata {
  id: string;
  slug: string;
  name: string;
  description: string;
  listingType: ListingType;
  status: ListingStatus;
  categorySlug: string;
  providerName: string;
  providerId: string;
  baseUrl: string;
  floorPriceUsdc: number;
  ceilingPriceUsdc: number | null;
  currentPriceUsdc: number;
  capacityPerMinute: number;
  isUnique: boolean;
  tags: string[];
  totalCalls: number;
  totalRevenue: number;
  avgRating: number;
  ratingCount: number;
  qualityScore: number;
  trustScore?: number;
  trustState?: "trusted" | "degraded" | "high_risk" | "unproven";
  avgLatencyMs: number;
  uptimePercent: number;
  authSchemes?: string[];
  interactionModes?: string[];
  humanApprovalRequired?: boolean;
  noHealthProbe?: boolean;
  riskLevel?: ListingRiskLevel;
  sideEffectLevel?: ListingSideEffectLevel;
  readiness?: ListingReadinessSnapshot;
  operationContracts?: ListingOperationContract[];
  publishedAt: string | null;
  createdAt: string;
}

// ─── AI Router ───

export interface RouteMatch {
  listing: Listing;
  score: number;
  scoreBreakdown: {
    textRelevance: number;
    categoryMatch: number;
    priceScore: number;
    qualityScore: number;
    trustScore?: number;
    regionAffinityScore?: number;
    popularityScore: number;
    latencyScore: number;
    capabilityMatch: number;
  };
  matchReasons: string[];
}

export interface RouteResult {
  queryId: string;
  rawQuery: string;
  intent: {
    category: string;
    confidence: number;
    entities: Record<string, unknown>;
  };
  matches: RouteMatch[];
  totalEvaluated: number;
  routeTimeMs: number;
  suggestions: string[];
}

// ─── Transactions ───

export interface Transaction {
  id: string;
  listingId: string;
  listingName: string;
  buyerId: string;
  status: TransactionStatus;
  priceUsdc: number;
  platformFeeUsdc: number;
  providerAmountUsdc: number;
  responseTimeMs: number;
  createdAt: string;
}

// ─── Wallet ───

export interface Wallet {
  address: string;
  chainId: number;
  balanceUsdc: number;
  escrowUsdc: number;
  autoDepositEnabled: boolean;
  autoDepositAmountUsdc: number;
  autoDepositThreshold: number;
  fundingSource: string | null;
  lastSyncedAt: string | null;
}

export interface WalletSettings {
  autoDepositEnabled?: boolean;
  autoDepositAmountUsdc?: number;
  autoDepositThreshold?: number;
  fundingSource?: string;
}

// ─── Provider ───

export interface ProviderProfile {
  id: string;
  companyName: string | null;
  totalRevenue: number;
  totalPayouts: number;
  pendingBalance: number;
  payoutAddress: string | null;
  autoPayoutEnabled: boolean;
  autoPayoutThreshold: number;
  listingCount: number;
}

export interface ProviderAnalytics {
  period: string;
  totalCalls: number;
  totalRevenueUsdc: number;
  platformFeesUsdc: number;
  netRevenueUsdc: number;
  uniqueBuyers: number;
  avgLatencyMs: number;
  errorRate: number;
  avgRating: number;
  demandScore: number;
  qualityScore: number;
  priceHistory: { timestamp: string; price: number }[];
  callVolume: { timestamp: string; calls: number }[];
  regionalLatency?: RegionalLatencySnapshot[];
  observability?: DiscoveryObservability;
  trust?: {
    listing: ListingTrustSnapshot;
    provider: ProviderTrustSnapshot;
  };
}

export interface TrustPenaltyBreakdown {
  successPenalty: number;
  upstreamFailurePenalty: number;
  breakerPenalty: number;
  settlementPenalty: number;
  disputePenalty: number;
  latencyPenalty: number;
}

export interface ListingTrustSnapshot {
  listingId: string;
  windowHours: number;
  score: number;
  state: "trusted" | "degraded" | "high_risk" | "unproven";
  totalExecutions: number;
  successRate: number;
  upstreamFailureRate: number;
  breakerOpenRate: number;
  settlementPendingRate: number;
  disputeRate: number;
  refundRate: number;
  p50LatencyMs: number | null;
  p99LatencyMs: number | null;
  latencyStability: number | null;
  penalties: TrustPenaltyBreakdown;
  penaltyTotal: number;
  reasons: string[];
}

export interface ProviderTrustSnapshot {
  providerId: string;
  windowHours: number;
  score: number;
  state: "trusted" | "degraded" | "high_risk" | "unproven";
  listingCount: number;
  ratedListingCount: number;
  averageListingTrust: number;
  highRiskListingCount: number;
  totalExecutions: number;
  reasons: string[];
}

export interface DiscoveryObservability {
  loggedQueries: number;
  acceptedQueries: number;
  conversionRate: number;
  apiKeyExecutions: number;
  x402SettledExecutions: number;
  x402PendingExecutions: number;
  lastAcceptedAt: string | null;
}

export interface RegionalLatencySnapshot {
  region: string;
  executionCount: number;
  successCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  lastSeenAt: string | null;
}

export interface ThrottledListing {
  listingId: string;
  slug: string;
  name: string;
  count: number;
  lastSeenAt: string | null;
}

export interface ThrottledBuyer {
  buyerId: string;
  displayName: string | null;
  email: string | null;
  count: number;
  lastSeenAt: string | null;
}

export interface ThrottleObservability {
  rateLimitedEvents: number;
  uniqueBuyerCount: number;
  uniqueListingCount: number;
  lastRateLimitedAt: string | null;
  topListings: ThrottledListing[];
  topBuyers: ThrottledBuyer[];
}

export interface AbuseBlockSnapshot {
  scope: "auth" | "payment";
  subjectKey: string;
  reason: "invalid_api_key" | "ip_restricted" | "payment_replay" | "payment_invalid";
  listingSlug: string | null;
  triggerCount: number;
  retryAfterMs: number;
  blockedUntil: string;
  updatedAt: string;
}

export interface AbuseProtectionSnapshot {
  backend: "redis" | "unavailable" | "error";
  totalTracked: number;
  totalAuthBlocks: number;
  totalPaymentBlocks: number;
  items: AbuseBlockSnapshot[];
}

export interface RateLimitingHealthSnapshot {
  backend: "shared_redis" | "local_fallback" | "error";
  status: "ok" | "warn" | "critical";
  message: string;
}

export interface PipelineHealth {
  status: "ok" | "warn" | "critical";
  pendingCount: number;
  retryBacklogCount: number;
  staleClaimCount: number;
  oldestPendingAgeMs: number | null;
  oldestRetryAgeMs: number | null;
  lastError: string | null;
}

export interface PlatformObservability {
  windowHours: number;
  indexing: PipelineHealth;
  settlement: PipelineHealth;
  discovery: DiscoveryObservability;
  throttling: ThrottleObservability;
  rateLimiting?: RateLimitingHealthSnapshot;
  abuseProtection?: AbuseProtectionSnapshot;
}

export interface ProviderObservability {
  windowHours: number;
  provider: {
    windowHours: number;
    discovery: DiscoveryObservability;
  };
}

// ─── Dashboard Stats ───

export interface DashboardStats {
  totalListings: number;
  totalCalls: number;
  totalRevenueUsdc: number;
  activeBuyers: number;
  avgQualityScore: number;
  topCategories: { slug: string; name: string; count: number }[];
}

// ─── Market Dashboard ───

export interface MarketActivity {
  totalListings: number;
  totalCalls: number;
  totalRevenueUsdc: number;
  activeBuyers: number;
  avgQualityScore: number;
  topListings: MarketListing[];
  topCategories: MarketCategory[];
}

export interface MarketListing {
  id: string;
  slug: string;
  name: string;
  providerName: string;
  listingType: ListingType;
  categorySlug: string;
  totalCalls: number;
  totalRevenue: number;
  currentPriceUsdc: number;
  qualityScore: number;
  avgLatencyMs: number;
  uptimePercent: number;
  tags: string[];
}

export interface MarketCategory {
  slug: string;
  name: string;
  listingCount: number;
  totalCalls: number;
  totalRevenue: number;
  listings: MarketListing[];
}

// ─── Spec Detection ───

export interface DetectEndpoint {
  path: string;
  method: string;
  summary: string;
  requestSchema: Record<string, unknown> | null;
}

export interface InputSchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface DetectResponse {
  detected: boolean;
  name: string;
  description: string;
  baseUrl: string;
  healthCheckUrl: string;
  docsUrl: string;
  authType: string;
  listingType: string;
  sampleRequest: Record<string, unknown> | null;
  sampleResponse: Record<string, unknown> | null;
  endpoints: DetectEndpoint[];
  operationContracts: ListingOperationContract[];
  inputSchemaFields: InputSchemaField[];
  suggestedCategorySlug: string | null;
  tags: string[];
  availabilityRegions?: string[];
  restrictedRegions?: string[];
  complianceTags?: string[];
  capabilityTags?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  domainMetadata?: Record<string, unknown>;
  healthCheckStatus: { ok: boolean; latencyMs: number } | null;
  warnings: string[];
}

// ─── Pagination ───

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Listing Detail (extended) ───

export interface ListingDetail extends Listing {
  healthCheckUrl: string | null;
  docsUrl: string | null;
  sandboxUrl: string | null;
  videoUrl: string | null;
  authType: string;
  categoryName: string;
  categoryId: string;
  sampleRequest: unknown | null;
  sampleResponse: unknown | null;
  schemaSpec?: Record<string, unknown> | null;
  operationContracts?: ListingOperationContract[];
  errorRatePercent: number;
  priceHistory: { timestamp: string; price: number; changePercent: number }[];
}

// ─── API Playground ───

export interface PlaygroundRequest {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers: Record<string, string>;
  body?: string;
}

export interface PlaygroundResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  responseTimeMs: number;
}

// ─── Price History ───

export interface PriceHistoryResponse {
  points: { timestamp: string; price: number; changePercent: number }[];
  high: number;
  low: number;
  current: number;
}

// ─── Price Ticker ───

export interface PriceTick {
  listingId: string;
  slug: string;
  name: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
}

// ─── Provider Activity Log ───

export interface ActivityEntry {
  id: string;
  status: TransactionStatus;
  priceUsdc: number;
  providerAmountUsdc: number;
  latencyMs: number;
  httpStatus: number;
  billingMode: "INDIVIDUAL" | "BUNDLE_STEP";
  createdAt: string;
  listingId: string;
  listingSlug: string;
  listingName: string;
  listingType: ListingType;
  buyerId: string;
  buyerName: string;
}
