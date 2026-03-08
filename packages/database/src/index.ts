// ═══════════════════════════════════════════════════════════════
// NexusX — Database Package Barrel Export
// packages/database/src/index.ts
//
// Clean re-export for all services:
//   import { prisma, lookupApiKeyByPrefix, ... } from "@nexusx/database";
// ═══════════════════════════════════════════════════════════════

// ─── Prisma Client ───
export { prisma, disconnectDatabase, checkDatabaseHealth } from "./client";

// ─── Embedding Service ───
export {
  searchListings,
  generateEmbedding,
  embedListing,
  embedAllListings,
  hasEmbeddings,
  buildEmbeddingText,
  type EmbeddingConfig,
  type SemanticSearchResult,
  type SearchListingsOptions,
  type PriorityMode,
  type FallbackReason,
  type EmbedResult,
} from "./embeddings";

// ─── Bazaar Indexer ───
export {
  indexBazaar,
  fetchBazaarResources,
  filterBazaarResources,
  generateBazaarSlug,
  inferCategorySlug,
  parseUsdcPrice,
  BAZAAR_PROVIDER_ID,
  GENERAL_CATEGORY_ID,
  type BazaarResource,
  type BazaarAccept,
  type IndexBazaarOptions,
  type IndexBazaarResult,
} from "./bazaar-indexer";

export {
  generateSyntheticQueries,
  generateAllSyntheticQueries,
  CURRENT_SYNTHETIC_VERSION,
} from "./synthetic-queries";

// ─── Activation Pipeline ───
export {
  enqueueActivationEvent,
  processActivation,
  type ActivationEvent,
  type ActivationPipelineResult,
} from "./activation-pipeline";

// ─── Metadata Filters ───
export {
  buildMetadataWhereClause,
  type MetadataFilters,
} from "./metadata-filters";

// ─── Deterministic Ranker ───
export { deterministicRank } from "./deterministic-ranker";

// ─── Cold-Start Explorer ───
export { computeExplorationBonus } from "./cold-start-explorer";

// ─── Demand Gap Tracker ───
export {
  recordUnmetDemand,
  getTopDemandGaps,
  checkDemandGapMatch,
} from "./demand-gap-tracker";

// ─── Control Plane ───
export {
  GATEWAY_ROUTE_VERSION_KEY,
  GATEWAY_PRICING_VERSION_KEY,
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  getControlPlaneVersion,
  getControlPlaneVersionMap,
  bumpControlPlaneVersion,
} from "./control-plane";

export {
  extractApiKeyPrefix,
  extractBearerApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  resolveUserFromRawApiKey,
  resolveUserIdFromRawApiKey,
  verifyApiKeyHash,
} from "./api-key-utils";

export {
  ABUSE_BLOCK_STATE_HASH_KEY,
  getAbuseBlockRedisKey,
  getAbuseCounterRedisKey,
  getAbuseHashField,
  isAbuseBlockExpired,
  parseAbuseBlockState,
  serializeAbuseBlockState,
  summarizeAbuseBlockStates,
  type AbuseBlockScope,
  type AbuseBlockReason,
  type AbuseBlockState,
  type AbuseBlockSnapshot,
  type AbuseBlockSummary,
} from "./abuse-state";

export {
  CIRCUIT_BREAKER_STATE_HASH_KEY,
  CIRCUIT_BREAKER_PROBE_PREFIX,
  DEFAULT_MANUAL_BREAKER_COOLDOWN_MS,
  MIN_MANUAL_BREAKER_COOLDOWN_MS,
  MAX_MANUAL_BREAKER_COOLDOWN_MS,
  createManualOpenCircuitState,
  getCircuitProbeKey,
  inspectSharedCircuitState,
  isSharedCircuitStateExpired,
  normalizeManualBreakerCooldownMs,
  parseSharedCircuitState,
  serializeSharedCircuitState,
  summarizeSharedCircuitStates,
  type CircuitInspectionSnapshot,
  type CircuitInspectionSummary,
  type SharedCircuitState,
} from "./circuit-breaker-state";

export {
  computeRegionAffinity,
  inferRegionBucket,
  type RegionAffinityResult,
} from "./region-affinity";

export {
  persistExecutionReceipt,
  updateExecutionReceiptSettlement,
  type ExecutionReceiptRecord,
  type PersistedExecutionReceiptRef,
  type ExecutionReceiptSettlementUpdate,
} from "./execution-receipts";

// ─── Operational Observability ───
export {
  markQueryLogSelected,
  getPlatformObservabilitySnapshot,
  getProviderObservabilitySnapshot,
  getListingRegionalLatencySnapshot,
  getListingTrustSnapshots,
  getProviderTrustSnapshot,
  type PlatformObservabilitySnapshot,
  type ProviderObservabilitySnapshot,
  type RegionalLatencySnapshot,
  type PipelineHealthSnapshot,
  type DiscoveryConversionSnapshot,
  type ThrottleObservabilitySnapshot,
  type ThrottledListingSnapshot,
  type ThrottledBuyerSnapshot,
  type TrustPenaltyBreakdown,
  type ListingTrustSnapshot,
  type ProviderTrustSnapshot,
} from "./observability";

// ─── Manifest (.well-known/nexusx.json) ───
export {
  validateManifest,
  type NexusXManifest,
  type NexusXManifestCapability,
} from "./manifest";

// ─── Typed Query Helpers ───
export {
  // Gateway
  lookupApiKeyByPrefix,
  touchApiKey,
  lookupListingBySlug,
  lookupListingById,
  persistTransaction,
  // Auction Engine
  persistDemandSignal,
  // AI Router
  loadActiveListingsForIndex,
  persistQueryLog,
  // Settlement
  getPendingTransactionsForSettlement,
  markTransactionsSettled,
} from "./helpers";

// ─── Re-export Prisma types for use in services ───
export type {
  User,
  ProviderProfile,
  Wallet,
  Category,
  Listing,
  DemandSignal,
  DemandSnapshot,
  ProviderMetricRaw,
  QualitySnapshot,
  SupplySnapshot,
  PriceSnapshot,
  AuctionResult,
  Transaction,
  Settlement,
  Payout,
  ApiKey,
  Subscription,
  WatchlistItem,
  Rating,
  QueryLog,
  ExecutionReceipt,
  PlatformConfig,
  AuditLog,
} from "@prisma/client";

export {
  UserRole,
  KycStatus,
  ListingStatus,
  ListingType,
  DemandSignalType,
  TransactionStatus,
  ExecutionAuthMode,
  ExecutionReceiptOutcome,
  ExecutionSettlementStatus,
  SettlementStatus,
  SubscriptionStatus,
  ApiKeyStatus,
  PayoutStatus,
  AuditAction,
} from "@prisma/client";
