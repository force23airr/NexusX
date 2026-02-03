// ═══════════════════════════════════════════════════════════════
// NexusX — Database Helpers
// packages/database/src/helpers.ts
//
// Typed query helpers that abstract common database operations
// used by the gateway, auction engine, AI router, and
// settlement service. Each function returns exactly the shape
// expected by the consuming service's type interface.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient, Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// GATEWAY: API Key Lookups
// ─────────────────────────────────────────────────────────────

/**
 * Look up an API key by its 8-char prefix.
 * Returns the key record + owner's wallet address (for escrow).
 */
export async function lookupApiKeyByPrefix(
  prisma: PrismaClient,
  prefix: string
) {
  const key = await prisma.apiKey.findFirst({
    where: { keyPrefix: prefix },
    include: {
      user: {
        include: { wallet: true },
      },
    },
  });

  if (!key || !key.user.wallet) return null;

  return {
    id: key.id,
    userId: key.userId,
    keyHash: key.keyHash,
    status: key.status,
    rateLimitRpm: key.rateLimitRpm,
    allowedIps: key.allowedIps,
    expiresAt: key.expiresAt,
    walletAddress: key.user.wallet.address,
  };
}

/**
 * Touch the last_used_at timestamp for an API key.
 */
export async function touchApiKey(
  prisma: PrismaClient,
  keyId: string
): Promise<void> {
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { lastUsedAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────
// GATEWAY: Listing Route Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a listing by slug for the gateway proxy.
 * Returns the fields needed for routing and billing.
 */
export async function lookupListingBySlug(
  prisma: PrismaClient,
  slug: string
) {
  const listing = await prisma.listing.findUnique({
    where: { slug },
    include: {
      provider: {
        include: { wallet: true },
      },
    },
  });

  if (!listing) return null;

  return {
    listingId: listing.id,
    providerId: listing.providerId,
    providerAddress: listing.provider.wallet?.address || "",
    baseUrl: listing.baseUrl,
    authType: listing.authType,
    currentPriceUsdc: Number(listing.currentPriceUsdc),
    floorPriceUsdc: Number(listing.floorPriceUsdc),
    capacityPerMinute: listing.capacityPerMinute,
    status: listing.status,
    isSandbox: !!listing.sandboxUrl,
  };
}

/**
 * Resolve a listing by ID for the gateway proxy.
 */
export async function lookupListingById(
  prisma: PrismaClient,
  id: string
) {
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      provider: {
        include: { wallet: true },
      },
    },
  });

  if (!listing) return null;

  return {
    listingId: listing.id,
    providerId: listing.providerId,
    providerAddress: listing.provider.wallet?.address || "",
    baseUrl: listing.baseUrl,
    authType: listing.authType,
    currentPriceUsdc: Number(listing.currentPriceUsdc),
    floorPriceUsdc: Number(listing.floorPriceUsdc),
    capacityPerMinute: listing.capacityPerMinute,
    status: listing.status,
    isSandbox: !!listing.sandboxUrl,
  };
}

// ─────────────────────────────────────────────────────────────
// GATEWAY: Transaction Persistence
// ─────────────────────────────────────────────────────────────

/**
 * Persist a transaction record from the gateway billing service.
 */
export async function persistTransaction(
  prisma: PrismaClient,
  record: {
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
): Promise<void> {
  await prisma.transaction.create({
    data: {
      listingId: record.listingId,
      buyerId: record.buyerId,
      status: "CONFIRMED",
      priceUsdc: record.priceUsdc,
      platformFeeUsdc: record.platformFeeUsdc,
      providerAmountUsdc: record.providerAmountUsdc,
      feeRateApplied: record.feeRateApplied,
      requestId: record.requestId,
      responseTimeMs: record.responseTimeMs,
      httpStatus: record.httpStatus,
      bytesTransferred: record.bytesTransferred,
    },
  });

  // Increment listing aggregate counters.
  await prisma.listing.update({
    where: { id: record.listingId },
    data: {
      totalCalls: { increment: 1 },
      totalRevenue: { increment: record.priceUsdc },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// AUCTION ENGINE: Demand Signals
// ─────────────────────────────────────────────────────────────

/**
 * Persist a demand signal from the gateway or frontend.
 */
export async function persistDemandSignal(
  prisma: PrismaClient,
  signal: {
    listingId: string;
    buyerId: string;
    type: string;
    weight: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await prisma.demandSignal.create({
    data: {
      listingId: signal.listingId,
      buyerId: signal.buyerId,
      type: signal.type as any,
      weight: signal.weight,
      metadata: signal.metadata || {},
    },
  });
}

// ─────────────────────────────────────────────────────────────
// AI ROUTER: Listing Index Loader
// ─────────────────────────────────────────────────────────────

/**
 * Load all active listings for the AI router's in-memory index.
 * Joins category path and latest quality snapshot.
 */
export async function loadActiveListingsForIndex(
  prisma: PrismaClient
) {
  const listings = await prisma.listing.findMany({
    where: { status: "ACTIVE" },
    include: {
      category: true,
      provider: true,
      qualitySnapshots: {
        orderBy: { computedAt: "desc" },
        take: 1,
      },
    },
  });

  return listings.map((l) => {
    const quality = l.qualitySnapshots[0];

    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      description: l.description,
      listingType: l.listingType,
      categorySlug: l.category.slug,
      categoryPath: buildCategoryPath(l.category),
      tags: l.tags,
      currentPriceUsdc: Number(l.currentPriceUsdc),
      floorPriceUsdc: Number(l.floorPriceUsdc),
      capacityPerMinute: l.capacityPerMinute,
      totalCalls: Number(l.totalCalls),
      avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 0,
      qualityScore: quality ? Number(quality.compositeScore) / 100 : 0.5,
      uptimePercent: quality ? Number(quality.uptimePercent) : 99.0,
      status: l.status,
      providerName: l.provider.displayName,
      providerId: l.providerId,
    };
  });
}

function buildCategoryPath(category: { slug: string }): string[] {
  // In production, recursively resolve parent chain.
  // For now, split slug by convention (e.g. "nlp" → ["ai", "nlp"]).
  return [category.slug];
}

// ─────────────────────────────────────────────────────────────
// AI ROUTER: Query Log Persistence
// ─────────────────────────────────────────────────────────────

/**
 * Persist an AI router query log.
 */
export async function persistQueryLog(
  prisma: PrismaClient,
  record: {
    id: string;
    buyerId: string;
    rawQuery: string;
    normalizedQuery: string;
    intentClassified: string;
    matchedListingId: string | null;
    confidenceScore: number;
    alternativeIds: string[];
    routeTimeMs: number;
  }
): Promise<void> {
  await prisma.queryLog.create({
    data: {
      id: record.id,
      buyerId: record.buyerId,
      rawQuery: record.rawQuery,
      normalizedQuery: record.normalizedQuery,
      intentClassified: record.intentClassified,
      matchedListingId: record.matchedListingId,
      confidenceScore: record.confidenceScore,
      alternativeIds: record.alternativeIds,
      routeTimeMs: record.routeTimeMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// SETTLEMENT: Pending Transactions
// ─────────────────────────────────────────────────────────────

/**
 * Get pending transactions grouped by buyer for batch settlement.
 */
export async function getPendingTransactionsForSettlement(
  prisma: PrismaClient,
  limit: number = 1000
) {
  return prisma.transaction.findMany({
    where: {
      status: "PENDING",
      settlementId: null,
    },
    include: {
      buyer: { include: { wallet: true } },
      listing: { include: { provider: { include: { wallet: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * Mark transactions as settled with a settlement reference.
 */
export async function markTransactionsSettled(
  prisma: PrismaClient,
  transactionIds: string[],
  settlementId: string
): Promise<void> {
  await prisma.transaction.updateMany({
    where: { id: { in: transactionIds } },
    data: {
      status: "CONFIRMED",
      settlementId,
      settledAt: new Date(),
    },
  });
}
