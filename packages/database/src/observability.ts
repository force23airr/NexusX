import type { Prisma, PrismaClient } from "@prisma/client";

const INDEXING_WARN_LAG_MS = 60_000;
const INDEXING_CRITICAL_LAG_MS = 5 * 60_000;
const SETTLEMENT_WARN_LAG_MS = 5 * 60_000;
const SETTLEMENT_CRITICAL_LAG_MS = 30 * 60_000;
const CLAIM_STALE_MS = 5 * 60_000;

export interface PipelineHealthSnapshot {
  status: "ok" | "warn" | "critical";
  pendingCount: number;
  retryBacklogCount: number;
  staleClaimCount: number;
  oldestPendingAgeMs: number | null;
  oldestRetryAgeMs: number | null;
  lastError: string | null;
}

export interface DiscoveryConversionSnapshot {
  loggedQueries: number;
  acceptedQueries: number;
  conversionRate: number;
  apiKeyExecutions: number;
  x402SettledExecutions: number;
  x402PendingExecutions: number;
  lastAcceptedAt: string | null;
}

export interface PlatformObservabilitySnapshot {
  windowHours: number;
  indexing: PipelineHealthSnapshot;
  settlement: PipelineHealthSnapshot;
  discovery: DiscoveryConversionSnapshot;
}

export interface ProviderObservabilitySnapshot {
  windowHours: number;
  discovery: DiscoveryConversionSnapshot;
}

function ageMs(value: Date | null | undefined): number | null {
  if (!value) return null;
  return Math.max(0, Date.now() - value.getTime());
}

function derivePipelineStatus(
  pendingCount: number,
  retryBacklogCount: number,
  oldestPendingAgeMs: number | null,
  warnLagMs: number,
  criticalLagMs: number,
): "ok" | "warn" | "critical" {
  if ((oldestPendingAgeMs ?? 0) >= criticalLagMs) return "critical";
  if (retryBacklogCount > 0) return "warn";
  if (pendingCount > 0 && (oldestPendingAgeMs ?? 0) >= warnLagMs) return "warn";
  return "ok";
}

export async function markQueryLogSelected(
  prisma: PrismaClient,
  input: {
    queryLogId: string;
    listingId: string;
    buyerId?: string;
  },
): Promise<boolean> {
  const where: Prisma.QueryLogWhereInput = {
    id: input.queryLogId,
    selectedAt: null,
  };

  if (input.buyerId) {
    where.buyerId = input.buyerId;
  }

  const updated = await prisma.queryLog.updateMany({
    where,
    data: {
      selectedListingId: input.listingId,
      selectedAt: new Date(),
      wasAccepted: true,
    },
  });

  return updated.count > 0;
}

export async function getPlatformObservabilitySnapshot(
  prisma: PrismaClient,
  options?: { windowHours?: number },
): Promise<PlatformObservabilitySnapshot> {
  const windowHours = options?.windowHours ?? 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const now = new Date();
  const staleClaimCutoff = new Date(now.getTime() - CLAIM_STALE_MS);

  const [
    pendingCount,
    retryBacklogCount,
    staleClaimCount,
    oldestPending,
    oldestRetry,
    latestRetryError,
    pendingSettlementCount,
    settlementRetryBacklogCount,
    staleSettlementClaimCount,
    oldestPendingSettlement,
    oldestSettlementRetry,
    latestSettlementError,
    loggedQueries,
    acceptedQueries,
    lastAccepted,
    apiKeyExecutions,
    x402SettledExecutions,
    x402PendingExecutions,
  ] = await Promise.all([
    prisma.pendingActivation.count({
      where: {
        availableAt: { lte: now },
      },
    }),
    prisma.pendingActivation.count({
      where: {
        availableAt: { lte: now },
        lastError: { not: null },
      },
    }),
    prisma.pendingActivation.count({
      where: {
        claimedAt: { lt: staleClaimCutoff },
      },
    }),
    prisma.pendingActivation.findFirst({
      where: {
        availableAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.pendingActivation.findFirst({
      where: {
        lastError: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.pendingActivation.findFirst({
      where: {
        lastError: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { lastError: true },
    }),
    prisma.x402SettlementRecord.count({
      where: {
        status: "SETTLEMENT_PENDING",
      },
    }),
    prisma.x402SettlementRecord.count({
      where: {
        status: "SETTLEMENT_PENDING",
        lastError: { not: null },
      },
    }),
    prisma.x402SettlementRecord.count({
      where: {
        status: "SETTLEMENT_PENDING",
        claimedAt: { lt: staleClaimCutoff },
      },
    }),
    prisma.x402SettlementRecord.findFirst({
      where: {
        status: "SETTLEMENT_PENDING",
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.x402SettlementRecord.findFirst({
      where: {
        status: "SETTLEMENT_PENDING",
        lastError: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.x402SettlementRecord.findFirst({
      where: {
        status: "SETTLEMENT_PENDING",
        lastError: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { lastError: true },
    }),
    prisma.queryLog.count({
      where: { createdAt: { gte: since } },
    }),
    prisma.queryLog.count({
      where: {
        createdAt: { gte: since },
        wasAccepted: true,
      },
    }),
    prisma.queryLog.findFirst({
      where: {
        createdAt: { gte: since },
        wasAccepted: true,
      },
      orderBy: { selectedAt: "desc" },
      select: { selectedAt: true },
    }),
    prisma.transaction.count({
      where: {
        createdAt: { gte: since },
        status: { in: ["CONFIRMED", "PENDING"] },
      },
    }),
    prisma.x402SettlementRecord.count({
      where: {
        createdAt: { gte: since },
        status: "SETTLED",
      },
    }),
    prisma.x402SettlementRecord.count({
      where: {
        createdAt: { gte: since },
        status: "SETTLEMENT_PENDING",
      },
    }),
  ]);

  const oldestPendingAgeMs = ageMs(oldestPending?.createdAt);
  const oldestRetryAgeMs = ageMs(oldestRetry?.createdAt);
  const oldestPendingSettlementAgeMs = ageMs(oldestPendingSettlement?.createdAt);
  const oldestRetrySettlementAgeMs = ageMs(oldestSettlementRetry?.createdAt);

  return {
    windowHours,
    indexing: {
      status: derivePipelineStatus(
        pendingCount,
        retryBacklogCount,
        oldestPendingAgeMs,
        INDEXING_WARN_LAG_MS,
        INDEXING_CRITICAL_LAG_MS,
      ),
      pendingCount,
      retryBacklogCount,
      staleClaimCount,
      oldestPendingAgeMs,
      oldestRetryAgeMs,
      lastError: latestRetryError?.lastError ?? null,
    },
    settlement: {
      status: derivePipelineStatus(
        pendingSettlementCount,
        settlementRetryBacklogCount,
        oldestPendingSettlementAgeMs,
        SETTLEMENT_WARN_LAG_MS,
        SETTLEMENT_CRITICAL_LAG_MS,
      ),
      pendingCount: pendingSettlementCount,
      retryBacklogCount: settlementRetryBacklogCount,
      staleClaimCount: staleSettlementClaimCount,
      oldestPendingAgeMs: oldestPendingSettlementAgeMs,
      oldestRetryAgeMs: oldestRetrySettlementAgeMs,
      lastError: latestSettlementError?.lastError ?? null,
    },
    discovery: {
      loggedQueries,
      acceptedQueries,
      conversionRate: loggedQueries > 0 ? acceptedQueries / loggedQueries : 0,
      apiKeyExecutions,
      x402SettledExecutions,
      x402PendingExecutions,
      lastAcceptedAt: lastAccepted?.selectedAt?.toISOString() ?? null,
    },
  };
}

export async function getProviderObservabilitySnapshot(
  prisma: PrismaClient,
  input: {
    providerId: string;
    listingId?: string;
    windowHours?: number;
  },
): Promise<ProviderObservabilitySnapshot> {
  const windowHours = input.windowHours ?? 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const matchedWhere: Prisma.QueryLogWhereInput = input.listingId
    ? {
        createdAt: { gte: since },
        matchedListingId: input.listingId,
      }
    : {
        createdAt: { gte: since },
        matchedListing: { providerId: input.providerId },
      };

  const selectedWhere: Prisma.QueryLogWhereInput = input.listingId
    ? {
        createdAt: { gte: since },
        selectedListingId: input.listingId,
        wasAccepted: true,
      }
    : {
        createdAt: { gte: since },
        wasAccepted: true,
        selectedListing: { providerId: input.providerId },
      };

  const transactionWhere: Prisma.TransactionWhereInput = input.listingId
    ? {
        createdAt: { gte: since },
        listingId: input.listingId,
        status: { in: ["CONFIRMED", "PENDING"] },
      }
    : {
        createdAt: { gte: since },
        status: { in: ["CONFIRMED", "PENDING"] },
        listing: { providerId: input.providerId },
      };

  const x402SettledWhere: Prisma.X402SettlementRecordWhereInput = input.listingId
    ? {
        createdAt: { gte: since },
        listingId: input.listingId,
        status: "SETTLED",
      }
    : {
        createdAt: { gte: since },
        status: "SETTLED",
        listing: { providerId: input.providerId },
      };

  const x402PendingWhere: Prisma.X402SettlementRecordWhereInput = input.listingId
    ? {
        createdAt: { gte: since },
        listingId: input.listingId,
        status: "SETTLEMENT_PENDING",
      }
    : {
        createdAt: { gte: since },
        status: "SETTLEMENT_PENDING",
        listing: { providerId: input.providerId },
      };

  const [loggedQueries, acceptedQueries, lastAccepted, apiKeyExecutions, x402SettledExecutions, x402PendingExecutions] =
    await Promise.all([
      prisma.queryLog.count({ where: matchedWhere }),
      prisma.queryLog.count({ where: selectedWhere }),
      prisma.queryLog.findFirst({
        where: selectedWhere,
        orderBy: { selectedAt: "desc" },
        select: { selectedAt: true },
      }),
      prisma.transaction.count({ where: transactionWhere }),
      prisma.x402SettlementRecord.count({ where: x402SettledWhere }),
      prisma.x402SettlementRecord.count({ where: x402PendingWhere }),
    ]);

  return {
    windowHours,
    discovery: {
      loggedQueries,
      acceptedQueries,
      conversionRate: loggedQueries > 0 ? acceptedQueries / loggedQueries : 0,
      apiKeyExecutions,
      x402SettledExecutions,
      x402PendingExecutions,
      lastAcceptedAt: lastAccepted?.selectedAt?.toISOString() ?? null,
    },
  };
}
