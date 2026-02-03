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
export type TransactionStatus = "PENDING" | "CONFIRMED" | "FAILED" | "REFUNDED" | "DISPUTED";

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

export interface Listing {
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
  avgLatencyMs: number;
  uptimePercent: number;
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
  lastSyncedAt: string | null;
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

// ─── Pagination ───

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
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
