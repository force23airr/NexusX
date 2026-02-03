// ═══════════════════════════════════════════════════════════════
// NexusX — Database Package Barrel Export
// packages/database/src/index.ts
//
// Clean re-export for all services:
//   import { prisma, lookupApiKeyByPrefix, ... } from "@nexusx/database";
// ═══════════════════════════════════════════════════════════════

// ─── Prisma Client ───
export { prisma, disconnectDatabase, checkDatabaseHealth } from "./client";

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
  SettlementStatus,
  SubscriptionStatus,
  ApiKeyStatus,
  PayoutStatus,
  AuditAction,
} from "@prisma/client";
