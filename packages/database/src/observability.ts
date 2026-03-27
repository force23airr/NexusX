import type { Prisma, PrismaClient } from "@prisma/client";

const INDEXING_WARN_LAG_MS = 60_000;
const INDEXING_CRITICAL_LAG_MS = 5 * 60_000;
const SETTLEMENT_WARN_LAG_MS = 5 * 60_000;
const SETTLEMENT_CRITICAL_LAG_MS = 30 * 60_000;
const CLAIM_STALE_MS = 5 * 60_000;
const DEFAULT_TRUST_WINDOW_HOURS = 24 * 7;
const TRUST_NEUTRAL_SCORE = 0.82;
const TRUST_SUCCESS_PRIOR_SUCCESS = 4.6;
const TRUST_SUCCESS_PRIOR_TOTAL = 5;

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

export interface ThrottledListingSnapshot {
  listingId: string;
  slug: string;
  name: string;
  count: number;
  lastSeenAt: string | null;
}

export interface ThrottledBuyerSnapshot {
  buyerId: string;
  displayName: string | null;
  email: string | null;
  count: number;
  lastSeenAt: string | null;
}

export interface ThrottleObservabilitySnapshot {
  rateLimitedEvents: number;
  uniqueBuyerCount: number;
  uniqueListingCount: number;
  lastRateLimitedAt: string | null;
  topListings: ThrottledListingSnapshot[];
  topBuyers: ThrottledBuyerSnapshot[];
}

export interface PlatformObservabilitySnapshot {
  windowHours: number;
  indexing: PipelineHealthSnapshot;
  settlement: PipelineHealthSnapshot;
  discovery: DiscoveryConversionSnapshot;
  throttling: ThrottleObservabilitySnapshot;
}

export interface ProviderObservabilitySnapshot {
  windowHours: number;
  discovery: DiscoveryConversionSnapshot;
}

export interface RegionalLatencySnapshot {
  region: string;
  executionCount: number;
  successCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  lastSeenAt: string | null;
}

export interface ListingOperationPerformanceSnapshot {
  listingId: string;
  operationId: string;
  windowHours: number;
  score: number;
  executionCount: number;
  successCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  lastSeenAt: string | null;
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

function ageMs(value: Date | null | undefined): number | null {
  if (!value) return null;
  return Math.max(0, Date.now() - value.getTime());
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compoundMapKey(listingId: string, operationId: string): string {
  return `${listingId}:${operationId}`;
}

function mapGroupCount<T extends { listingId: string | null; _count: { _all: number } }>(
  rows: T[],
): Map<string, number> {
  return new Map(
    rows
      .filter((row): row is T & { listingId: string } => typeof row.listingId === "string")
      .map((row) => [row.listingId, row._count._all]),
  );
}

function mapNullableStringCount<T extends { callerRegionBucket: string | null; _count: { _all: number } }>(
  rows: T[],
): Map<string, number> {
  return new Map(
    rows
      .filter((row): row is T & { callerRegionBucket: string } => typeof row.callerRegionBucket === "string" && row.callerRegionBucket.length > 0)
      .map((row) => [row.callerRegionBucket, row._count._all]),
  );
}

function mapNullableStringAverage<T extends { callerRegionBucket: string | null; _avg: { latencyMs: number | null } }>(
  rows: T[],
): Map<string, number | null> {
  return new Map(
    rows
      .filter((row): row is T & { callerRegionBucket: string } => typeof row.callerRegionBucket === "string" && row.callerRegionBucket.length > 0)
      .map((row) => [row.callerRegionBucket, row._avg.latencyMs]),
  );
}

function mapNullableStringTimestamp<T extends { callerRegionBucket: string | null; _max: { createdAt: Date | null } }>(
  rows: T[],
): Map<string, Date | null> {
  return new Map(
    rows
      .filter((row): row is T & { callerRegionBucket: string } => typeof row.callerRegionBucket === "string" && row.callerRegionBucket.length > 0)
      .map((row) => [row.callerRegionBucket, row._max.createdAt ?? null]),
  );
}

function deriveTrustState(
  score: number,
  totalExecutions: number,
): "trusted" | "degraded" | "high_risk" | "unproven" {
  if (totalExecutions === 0) return "unproven";
  if (score >= 0.85) return "trusted";
  if (score >= 0.65) return "degraded";
  return "high_risk";
}

function buildTrustReasons(
  penalties: TrustPenaltyBreakdown,
  rates: {
    successRate: number;
    upstreamFailureRate: number;
    breakerOpenRate: number;
    settlementPendingRate: number;
    disputeRate: number;
    refundRate: number;
    latencyStability: number | null;
    p99LatencyMs: number | null;
  },
): string[] {
  const reasons: string[] = [];

  if (penalties.successPenalty >= 0.1) {
    reasons.push(`Recent success rate is ${(rates.successRate * 100).toFixed(1)}%.`);
  }
  if (penalties.upstreamFailurePenalty >= 0.05) {
    reasons.push(`Recent upstream failure rate is ${(rates.upstreamFailureRate * 100).toFixed(1)}%.`);
  }
  if (penalties.breakerPenalty >= 0.04) {
    reasons.push(`Breaker-open responses reached ${(rates.breakerOpenRate * 100).toFixed(1)}% of attempts.`);
  }
  if (penalties.settlementPenalty >= 0.03) {
    reasons.push(
      `Settlement reconciliation is pending on ${(rates.settlementPendingRate * 100).toFixed(1)}% of paid calls.`,
    );
  }
  if (penalties.disputePenalty >= 0.03) {
    reasons.push(
      `Refund/dispute rate is ${((rates.disputeRate + rates.refundRate) * 100).toFixed(1)}% of billed calls.`,
    );
  }
  if (
    penalties.latencyPenalty >= 0.03 &&
    rates.latencyStability !== null &&
    rates.p99LatencyMs !== null
  ) {
    reasons.push(
      `Latency is unstable (p99 ${Math.round(rates.p99LatencyMs)}ms, spread ${rates.latencyStability.toFixed(2)}x).`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("Recent execution behavior is stable.");
  }

  return reasons;
}

function buildListingTrustSnapshot(input: {
  listingId: string;
  windowHours: number;
  totalExecutions: number;
  successCount: number;
  upstreamFailureCount: number;
  breakerOpenCount: number;
  pendingSettlementCount: number;
  abandonedSettlementCount: number;
  billedTransactionCount: number;
  disputedCount: number;
  refundedCount: number;
  p50LatencyMs: number | null;
  p99LatencyMs: number | null;
}): ListingTrustSnapshot {
  const {
    listingId,
    windowHours,
    totalExecutions,
    successCount,
    upstreamFailureCount,
    breakerOpenCount,
    pendingSettlementCount,
    abandonedSettlementCount,
    billedTransactionCount,
    disputedCount,
    refundedCount,
    p50LatencyMs,
    p99LatencyMs,
  } = input;

  if (totalExecutions === 0 && billedTransactionCount === 0 && p50LatencyMs === null && p99LatencyMs === null) {
    return {
      listingId,
      windowHours,
      score: TRUST_NEUTRAL_SCORE,
      state: "unproven",
      totalExecutions,
      successRate: 0,
      upstreamFailureRate: 0,
      breakerOpenRate: 0,
      settlementPendingRate: 0,
      disputeRate: 0,
      refundRate: 0,
      p50LatencyMs,
      p99LatencyMs,
      latencyStability: null,
      penalties: {
        successPenalty: 0,
        upstreamFailurePenalty: 0,
        breakerPenalty: 0,
        settlementPenalty: 0,
        disputePenalty: 0,
        latencyPenalty: 0,
      },
      penaltyTotal: 1 - TRUST_NEUTRAL_SCORE,
      reasons: ["Not enough execution history yet. Using a neutral trust prior."],
    };
  }

  const blendedSuccessRate =
    (successCount + TRUST_SUCCESS_PRIOR_SUCCESS) / (totalExecutions + TRUST_SUCCESS_PRIOR_TOTAL);
  const upstreamFailureRate = totalExecutions > 0 ? upstreamFailureCount / totalExecutions : 0;
  const breakerOpenRate = totalExecutions > 0 ? breakerOpenCount / totalExecutions : 0;
  const x402ExecutionCount = successCount + upstreamFailureCount + pendingSettlementCount + abandonedSettlementCount;
  const settlementPendingRate = x402ExecutionCount > 0
    ? (pendingSettlementCount + abandonedSettlementCount) / x402ExecutionCount
    : 0;
  const disputeRate = billedTransactionCount > 0 ? disputedCount / billedTransactionCount : 0;
  const refundRate = billedTransactionCount > 0 ? refundedCount / billedTransactionCount : 0;
  const latencyStability =
    p50LatencyMs && p50LatencyMs > 0 && p99LatencyMs && p99LatencyMs > 0
      ? p99LatencyMs / p50LatencyMs
      : null;

  const successPenalty = clamp01((0.97 - blendedSuccessRate) / 0.32) * 0.34;
  const upstreamFailurePenalty = clamp01(upstreamFailureRate / 0.2) * 0.18;
  const breakerPenalty = clamp01(breakerOpenRate / 0.15) * 0.16;
  const settlementPenalty = clamp01(settlementPendingRate / 0.18) * 0.12;
  const disputePenalty = clamp01((disputeRate + refundRate) / 0.08) * 0.14;
  const latencyPenalty = latencyStability === null
    ? 0.02
    : clamp01((latencyStability - 3) / 5) * 0.07 +
      clamp01(((p99LatencyMs ?? 0) - 2500) / 5500) * 0.05;

  const penalties: TrustPenaltyBreakdown = {
    successPenalty,
    upstreamFailurePenalty,
    breakerPenalty,
    settlementPenalty,
    disputePenalty,
    latencyPenalty,
  };

  const penaltyTotal = Object.values(penalties).reduce((sum, penalty) => sum + penalty, 0);
  const score = clamp01(1 - penaltyTotal);

  return {
    listingId,
    windowHours,
    score,
    state: deriveTrustState(score, totalExecutions),
    totalExecutions,
    successRate: blendedSuccessRate,
    upstreamFailureRate,
    breakerOpenRate,
    settlementPendingRate,
    disputeRate,
    refundRate,
    p50LatencyMs,
    p99LatencyMs,
    latencyStability,
    penalties,
    penaltyTotal,
    reasons: buildTrustReasons(penalties, {
      successRate: blendedSuccessRate,
      upstreamFailureRate,
      breakerOpenRate,
      settlementPendingRate,
      disputeRate,
      refundRate,
      latencyStability,
      p99LatencyMs,
    }),
  };
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
    rateLimitedEvents,
    lastRateLimited,
    topListingThrottleRows,
    topBuyerThrottleRows,
    uniqueBuyerThrottleRows,
    uniqueListingThrottleRows,
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
    prisma.demandSignal.count({
      where: {
        capturedAt: { gte: since },
        type: "RATE_LIMITED",
      },
    }),
    prisma.demandSignal.findFirst({
      where: {
        capturedAt: { gte: since },
        type: "RATE_LIMITED",
      },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
    prisma.demandSignal.groupBy({
      by: ["listingId"],
      where: {
        capturedAt: { gte: since },
        type: "RATE_LIMITED",
      },
      _count: { _all: true },
      _max: { capturedAt: true },
      orderBy: { _count: { listingId: "desc" } },
      take: 5,
    }),
    prisma.demandSignal.groupBy({
      by: ["buyerId"],
      where: {
        capturedAt: { gte: since },
        type: "RATE_LIMITED",
        buyerId: { not: null },
      },
      _count: { _all: true },
      _max: { capturedAt: true },
      orderBy: { _count: { buyerId: "desc" } },
      take: 5,
    }),
    prisma.demandSignal.groupBy({
      by: ["buyerId"],
      where: {
        capturedAt: { gte: since },
        type: "RATE_LIMITED",
        buyerId: { not: null },
      },
    }),
    prisma.demandSignal.groupBy({
      by: ["listingId"],
      where: {
        capturedAt: { gte: since },
        type: "RATE_LIMITED",
      },
    }),
  ]);

  const [throttledListings, throttledBuyers] = await Promise.all([
    topListingThrottleRows.length > 0
      ? prisma.listing.findMany({
          where: {
            id: {
              in: topListingThrottleRows.map((row) => row.listingId),
            },
          },
          select: {
            id: true,
            slug: true,
            name: true,
          },
        })
      : Promise.resolve([]),
    topBuyerThrottleRows.length > 0
      ? prisma.user.findMany({
          where: {
            id: {
              in: topBuyerThrottleRows
                .map((row) => row.buyerId)
                .filter((value): value is string => typeof value === "string"),
            },
          },
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const listingById = new Map(throttledListings.map((listing) => [listing.id, listing]));
  const buyerById = new Map(throttledBuyers.map((buyer) => [buyer.id, buyer]));

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
    throttling: {
      rateLimitedEvents,
      uniqueBuyerCount: uniqueBuyerThrottleRows.filter(
        (row): row is typeof row & { buyerId: string } => typeof row.buyerId === "string",
      ).length,
      uniqueListingCount: uniqueListingThrottleRows.length,
      lastRateLimitedAt: lastRateLimited?.capturedAt?.toISOString() ?? null,
      topListings: topListingThrottleRows.map((row) => {
        const listing = listingById.get(row.listingId);
        return {
          listingId: row.listingId,
          slug: listing?.slug ?? row.listingId,
          name: listing?.name ?? row.listingId,
          count: row._count._all,
          lastSeenAt: row._max.capturedAt?.toISOString() ?? null,
        };
      }),
      topBuyers: topBuyerThrottleRows
        .filter((row): row is typeof row & { buyerId: string } => typeof row.buyerId === "string")
        .map((row) => {
          const buyer = buyerById.get(row.buyerId);
          return {
            buyerId: row.buyerId,
            displayName: buyer?.displayName ?? null,
            email: buyer?.email ?? null,
            count: row._count._all,
            lastSeenAt: row._max.capturedAt?.toISOString() ?? null,
          };
        }),
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

export async function getListingRegionalLatencySnapshot(
  prisma: PrismaClient,
  input: {
    listingId: string;
    windowHours?: number;
  },
): Promise<RegionalLatencySnapshot[]> {
  const windowHours = input.windowHours ?? 24 * 7;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const where: Prisma.ExecutionReceiptWhereInput = {
    listingId: input.listingId,
    createdAt: { gte: since },
    sandbox: false,
    callerRegionBucket: { not: null },
    outcome: { in: ["SUCCESS", "FAILED"] },
  };

  const [totals, successes, averages, lastSeen] = await Promise.all([
    prisma.executionReceipt.groupBy({
      by: ["callerRegionBucket"],
      where,
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["callerRegionBucket"],
      where: {
        ...where,
        outcome: "SUCCESS",
      },
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["callerRegionBucket"],
      where: {
        ...where,
        outcome: "SUCCESS",
        latencyMs: { not: null },
      },
      _avg: { latencyMs: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["callerRegionBucket"],
      where,
      _max: { createdAt: true },
    }),
  ]);

  const totalMap = mapNullableStringCount(totals);
  const successMap = mapNullableStringCount(successes);
  const averageMap = mapNullableStringAverage(averages);
  const lastSeenMap = mapNullableStringTimestamp(lastSeen);

  return Array.from(totalMap.entries())
    .map(([region, executionCount]) => {
      const successCount = successMap.get(region) ?? 0;
      return {
        region,
        executionCount,
        successCount,
        successRate: executionCount > 0 ? successCount / executionCount : 0,
        avgLatencyMs: averageMap.get(region) ?? null,
        lastSeenAt: lastSeenMap.get(region)?.toISOString() ?? null,
      };
    })
    .sort((a, b) => {
      if (b.executionCount !== a.executionCount) return b.executionCount - a.executionCount;
      return (a.avgLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.avgLatencyMs ?? Number.MAX_SAFE_INTEGER);
    });
}

export async function getListingOperationPerformanceSnapshots(
  prisma: PrismaClient,
  input: {
    listingIds: string[];
    operationIds?: string[];
    windowHours?: number;
  },
): Promise<ListingOperationPerformanceSnapshot[]> {
  const listingIds = Array.from(new Set(input.listingIds.filter(Boolean)));
  if (listingIds.length === 0) return [];

  const operationIds = input.operationIds
    ? Array.from(new Set(input.operationIds.filter(Boolean)))
    : undefined;
  const windowHours = input.windowHours ?? DEFAULT_TRUST_WINDOW_HOURS;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const baseWhere: Prisma.ExecutionReceiptWhereInput = {
    listingId: { in: listingIds },
    createdAt: { gte: since },
    sandbox: false,
    operationId: operationIds ? { in: operationIds } : { not: null },
    outcome: { in: ["SUCCESS", "FAILED"] },
  };

  const [totals, successes] = await Promise.all([
    prisma.executionReceipt.groupBy({
      by: ["listingId", "operationId"],
      where: baseWhere,
      _count: { _all: true },
      _avg: { latencyMs: true },
      _max: { createdAt: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["listingId", "operationId"],
      where: {
        ...baseWhere,
        outcome: "SUCCESS",
      },
      _count: { _all: true },
    }),
  ]);

  const successMap = new Map<string, number>();
  for (const row of successes) {
    if (!row.listingId || !row.operationId) continue;
    successMap.set(compoundMapKey(row.listingId, row.operationId), row._count._all);
  }

  return totals
    .filter(
      (
        row,
      ): row is typeof row & { listingId: string; operationId: string } =>
        typeof row.listingId === "string" && typeof row.operationId === "string",
    )
    .map((row) => {
      const key = compoundMapKey(row.listingId, row.operationId);
      const executionCount = row._count._all;
      const successCount = successMap.get(key) ?? 0;
      const successRate = executionCount > 0 ? successCount / executionCount : 0;
      const smoothedSuccessRate = (successCount + 2) / (executionCount + 3);
      const avgLatencyMs = row._avg.latencyMs ?? null;
      const latencyScore =
        avgLatencyMs === null ? 0.6 : clamp01(1 - avgLatencyMs / 2500);
      const confidenceBonus = Math.min(executionCount / 20, 1) * 0.05;
      const score = clamp01(
        smoothedSuccessRate * 0.75 + latencyScore * 0.20 + confidenceBonus,
      );

      return {
        listingId: row.listingId,
        operationId: row.operationId,
        windowHours,
        score,
        executionCount,
        successCount,
        successRate,
        avgLatencyMs,
        lastSeenAt: row._max.createdAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.executionCount - a.executionCount;
    });
}

export async function getListingTrustSnapshots(
  prisma: PrismaClient,
  input: {
    listingIds: string[];
    windowHours?: number;
  },
): Promise<ListingTrustSnapshot[]> {
  const listingIds = Array.from(new Set(input.listingIds.filter(Boolean)));
  if (listingIds.length === 0) return [];

  const windowHours = input.windowHours ?? DEFAULT_TRUST_WINDOW_HOURS;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const executionWhere: Prisma.ExecutionReceiptWhereInput = {
    listingId: { in: listingIds },
    createdAt: { gte: since },
    sandbox: false,
    outcome: { in: ["SUCCESS", "FAILED"] },
  };

  const [
    totalExecutions,
    successfulExecutions,
    upstreamFailures,
    breakerOpenCounts,
    pendingSettlements,
    abandonedSettlements,
    billedTransactions,
    disputedTransactions,
    refundedTransactions,
    qualitySnapshots,
  ] = await Promise.all([
    prisma.executionReceipt.groupBy({
      by: ["listingId"],
      where: executionWhere,
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["listingId"],
      where: {
        ...executionWhere,
        outcome: "SUCCESS",
      },
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["listingId"],
      where: {
        ...executionWhere,
        httpStatus: { gte: 500 },
      },
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["listingId"],
      where: {
        listingId: { in: listingIds },
        createdAt: { gte: since },
        sandbox: false,
        circuitState: "open",
      },
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["listingId"],
      where: {
        listingId: { in: listingIds },
        createdAt: { gte: since },
        sandbox: false,
        settlementStatus: "PENDING_RECONCILIATION",
      },
      _count: { _all: true },
    }),
    prisma.executionReceipt.groupBy({
      by: ["listingId"],
      where: {
        listingId: { in: listingIds },
        createdAt: { gte: since },
        sandbox: false,
        settlementStatus: "ABANDONED",
      },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["listingId"],
      where: {
        listingId: { in: listingIds },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["listingId"],
      where: {
        listingId: { in: listingIds },
        createdAt: { gte: since },
        status: "DISPUTED",
      },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["listingId"],
      where: {
        listingId: { in: listingIds },
        createdAt: { gte: since },
        status: "REFUNDED",
      },
      _count: { _all: true },
    }),
    prisma.qualitySnapshot.findMany({
      where: {
        listingId: { in: listingIds },
        computedAt: { gte: since },
      },
      orderBy: [{ listingId: "asc" }, { computedAt: "desc" }],
      select: {
        listingId: true,
        medianLatencyMs: true,
        p99LatencyMs: true,
      },
    }),
  ]);

  const totalMap = mapGroupCount(totalExecutions);
  const successMap = mapGroupCount(successfulExecutions);
  const upstreamFailureMap = mapGroupCount(upstreamFailures);
  const breakerMap = mapGroupCount(breakerOpenCounts);
  const pendingSettlementMap = mapGroupCount(pendingSettlements);
  const abandonedSettlementMap = mapGroupCount(abandonedSettlements);
  const billedTransactionMap = mapGroupCount(billedTransactions);
  const disputedMap = mapGroupCount(disputedTransactions);
  const refundedMap = mapGroupCount(refundedTransactions);
  const qualityMap = new Map<string, { p50LatencyMs: number | null; p99LatencyMs: number | null }>();

  for (const snapshot of qualitySnapshots) {
    if (qualityMap.has(snapshot.listingId)) continue;
    qualityMap.set(snapshot.listingId, {
      p50LatencyMs: Number(snapshot.medianLatencyMs),
      p99LatencyMs: Number(snapshot.p99LatencyMs),
    });
  }

  return listingIds.map((listingId) =>
    buildListingTrustSnapshot({
      listingId,
      windowHours,
      totalExecutions: totalMap.get(listingId) ?? 0,
      successCount: successMap.get(listingId) ?? 0,
      upstreamFailureCount: upstreamFailureMap.get(listingId) ?? 0,
      breakerOpenCount: breakerMap.get(listingId) ?? 0,
      pendingSettlementCount: pendingSettlementMap.get(listingId) ?? 0,
      abandonedSettlementCount: abandonedSettlementMap.get(listingId) ?? 0,
      billedTransactionCount: billedTransactionMap.get(listingId) ?? 0,
      disputedCount: disputedMap.get(listingId) ?? 0,
      refundedCount: refundedMap.get(listingId) ?? 0,
      p50LatencyMs: qualityMap.get(listingId)?.p50LatencyMs ?? null,
      p99LatencyMs: qualityMap.get(listingId)?.p99LatencyMs ?? null,
    }),
  );
}

export async function getProviderTrustSnapshot(
  prisma: PrismaClient,
  input: {
    providerId: string;
    windowHours?: number;
  },
): Promise<ProviderTrustSnapshot> {
  const windowHours = input.windowHours ?? DEFAULT_TRUST_WINDOW_HOURS;
  const listings = await prisma.listing.findMany({
    where: { providerId: input.providerId },
    select: { id: true },
  });
  const listingIds = listings.map((listing) => listing.id);

  if (listingIds.length === 0) {
    return {
      providerId: input.providerId,
      windowHours,
      score: TRUST_NEUTRAL_SCORE,
      state: "unproven",
      listingCount: 0,
      ratedListingCount: 0,
      averageListingTrust: TRUST_NEUTRAL_SCORE,
      highRiskListingCount: 0,
      totalExecutions: 0,
      reasons: ["No listings published yet."],
    };
  }

  const trustSnapshots = await getListingTrustSnapshots(prisma, {
    listingIds,
    windowHours,
  });

  const ratedListingCount = trustSnapshots.filter((snapshot) => snapshot.totalExecutions > 0).length;
  const totalExecutions = trustSnapshots.reduce((sum, snapshot) => sum + snapshot.totalExecutions, 0);
  const weightedTrust = trustSnapshots.reduce((sum, snapshot) => {
    const weight = Math.max(snapshot.totalExecutions, 1);
    return sum + snapshot.score * weight;
  }, 0);
  const totalWeight = trustSnapshots.reduce((sum, snapshot) => sum + Math.max(snapshot.totalExecutions, 1), 0);
  const averageListingTrust =
    trustSnapshots.reduce((sum, snapshot) => sum + snapshot.score, 0) / Math.max(trustSnapshots.length, 1);
  const score = totalWeight > 0 ? weightedTrust / totalWeight : TRUST_NEUTRAL_SCORE;
  const highRiskListingCount = trustSnapshots.filter((snapshot) => snapshot.state === "high_risk").length;

  const reasons: string[] = [];
  if (highRiskListingCount > 0) {
    reasons.push(`${highRiskListingCount} listing(s) are currently high risk.`);
  }
  if (ratedListingCount === 0) {
    reasons.push("Execution history is still sparse across this provider.");
  }
  if (reasons.length === 0) {
    reasons.push("Provider trust is stable across recent listing executions.");
  }

  return {
    providerId: input.providerId,
    windowHours,
    score,
    state: deriveTrustState(score, totalExecutions),
    listingCount: listingIds.length,
    ratedListingCount,
    averageListingTrust,
    highRiskListingCount,
    totalExecutions,
    reasons,
  };
}
