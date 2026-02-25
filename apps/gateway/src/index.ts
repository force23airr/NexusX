// ═══════════════════════════════════════════════════════════════
// NexusX — Gateway Entrypoint
// apps/gateway/src/index.ts
//
// Bootstraps the gateway with Prisma-backed dependencies.
// ═══════════════════════════════════════════════════════════════

import { Prisma, PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { startGateway } from "./server";
import type { GatewayDependencies } from "./server";
import type { BundleSessionFinalizeResult, BundleSessionRecord } from "./types";
import { PriceWebSocketServer } from "./services/priceWebSocket";

const prisma = new PrismaClient();

const deps: GatewayDependencies = {
  lookupApiKey: async (prefix: string) => {
    const key = await prisma.apiKey.findFirst({
      where: { keyPrefix: prefix, status: "ACTIVE" },
      include: { user: { include: { wallet: true } } },
    });
    if (!key) return null;
    return {
      id: key.id,
      userId: key.userId,
      keyHash: key.keyHash,
      status: key.status,
      rateLimitRpm: key.rateLimitRpm,
      allowedIps: key.allowedIps,
      expiresAt: key.expiresAt,
      walletAddress: key.user.wallet?.address ?? "",
    };
  },

  touchApiKey: async (keyId: string) => {
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  },

  lookupListingBySlug: async (slug: string) => {
    const listing = await prisma.listing.findUnique({
      where: { slug },
      include: { provider: { include: { providerProfile: true } } },
    });
    if (!listing || listing.status !== "ACTIVE") return null;
    return {
      listingId: listing.id,
      providerId: listing.providerId,
      providerAddress: listing.provider.providerProfile?.payoutAddress ?? "",
      baseUrl: listing.baseUrl,
      authType: listing.authType,
      currentPriceUsdc: decimalToNumber(listing.currentPriceUsdc),
      floorPriceUsdc: decimalToNumber(listing.floorPriceUsdc),
      capacityPerMinute: listing.capacityPerMinute,
      status: listing.status,
      isSandbox: listing.sandboxUrl !== null,
    };
  },

  lookupListingById: async (id: string) => {
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { provider: { include: { providerProfile: true } } },
    });
    if (!listing) return null;
    return {
      listingId: listing.id,
      providerId: listing.providerId,
      providerAddress: listing.provider.providerProfile?.payoutAddress ?? "",
      baseUrl: listing.baseUrl,
      authType: listing.authType,
      currentPriceUsdc: decimalToNumber(listing.currentPriceUsdc),
      floorPriceUsdc: decimalToNumber(listing.floorPriceUsdc),
      capacityPerMinute: listing.capacityPerMinute,
      status: listing.status,
      isSandbox: listing.sandboxUrl !== null,
    };
  },

  persistTransaction: async (record) => {
    await prisma.transaction.create({
      data: {
        requestId: record.requestId,
        listingId: record.listingId,
        buyerId: record.buyerId,
        status: record.status ?? (record.billingMode === "BUNDLE_STEP" ? "PENDING" : "CONFIRMED"),
        billingMode: record.billingMode ?? "INDIVIDUAL",
        bundleSessionId: record.bundleSessionId ?? null,
        bundleStepIndex: record.bundleStepIndex ?? null,
        settledViaBundle: record.settledViaBundle ?? false,
        priceUsdc: toUsdcDecimal(record.priceUsdc),
        platformFeeUsdc: toUsdcDecimal(record.platformFeeUsdc),
        providerAmountUsdc: toUsdcDecimal(record.providerAmountUsdc),
        feeRateApplied: new Prisma.Decimal(record.feeRateApplied.toFixed(4)),
        quotedPriceUsdc:
          typeof record.quotedPriceUsdc === "number"
            ? toUsdcDecimal(record.quotedPriceUsdc)
            : null,
        quotedPlatformFeeUsdc:
          typeof record.quotedPlatformFeeUsdc === "number"
            ? toUsdcDecimal(record.quotedPlatformFeeUsdc)
            : null,
        quotedProviderAmountUsdc:
          typeof record.quotedProviderAmountUsdc === "number"
            ? toUsdcDecimal(record.quotedProviderAmountUsdc)
            : null,
        responseTimeMs: record.responseTimeMs,
        httpStatus: record.httpStatus,
        bytesTransferred: record.bytesTransferred,
      },
    });
  },

  registerBundleSession: async (input) => {
    if (input.toolSlugs.length === 0) {
      throw gatewayError("INVALID_INPUT", "tool_slugs must contain at least one listing slug.");
    }
    if (!Number.isFinite(input.bundlePriceUsdc) || input.bundlePriceUsdc <= 0) {
      throw gatewayError("INVALID_INPUT", "bundle_price_usdc must be a positive number.");
    }

    const requestedSlugs = input.toolSlugs.map((slug) => slug.trim()).filter(Boolean);
    if (requestedSlugs.length === 0) {
      throw gatewayError("INVALID_INPUT", "tool_slugs contains no valid listing slugs.");
    }

    const uniqueRequested = Array.from(new Set(requestedSlugs));
    const listings = await prisma.listing.findMany({
      where: {
        slug: { in: uniqueRequested },
        status: "ACTIVE",
      },
      select: {
        id: true,
        slug: true,
        currentPriceUsdc: true,
      },
    });

    const bySlug = new Map(listings.map((listing) => [listing.slug, listing]));
    const missing = uniqueRequested.filter((slug) => !bySlug.has(slug));
    if (missing.length > 0) {
      throw gatewayError(
        "INVALID_INPUT",
        "Some requested tool slugs are not available.",
      );
    }

    const registeredGrossPriceUsdc = roundUsdc(
      requestedSlugs.reduce((sum, slug) => {
        const listing = bySlug.get(slug)!;
        return sum + decimalToNumber(listing.currentPriceUsdc);
      }, 0),
    );

    if (input.bundlePriceUsdc > registeredGrossPriceUsdc) {
      throw gatewayError(
        "INVALID_INPUT",
        `bundle_price_usdc (${input.bundlePriceUsdc.toFixed(6)}) cannot exceed gross list price (${registeredGrossPriceUsdc.toFixed(6)}).`,
      );
    }

    const feeRate = clamp(input.bundlePlatformFeeRate, 0, 1);

    const created = await prisma.bundleExecutionSession.create({
      data: {
        buyerId: input.buyerId,
        apiKeyId: input.apiKeyId || null,
        bundleSlug: input.bundleSlug,
        bundleName: input.bundleName ?? null,
        status: "REGISTERED",
        toolSlugs: requestedSlugs,
        registeredGrossPriceUsdc: toUsdcDecimal(registeredGrossPriceUsdc),
        executedGrossPriceUsdc: toUsdcDecimal(0),
        targetBundlePriceUsdc: toUsdcDecimal(roundUsdc(input.bundlePriceUsdc)),
        billedPriceUsdc: toUsdcDecimal(0),
        discountUsdc: toUsdcDecimal(0),
        platformFeeRate: new Prisma.Decimal(feeRate.toFixed(4)),
        platformFeeUsdc: toUsdcDecimal(0),
        providerPoolUsdc: toUsdcDecimal(0),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ?? null,
      },
    });

    return mapBundleSession(created);
  },

  lookupBundleSession: async (bundleSessionId) => {
    const session = await prisma.bundleExecutionSession.findUnique({
      where: { id: bundleSessionId },
    });
    if (!session) return null;
    return mapBundleSession(session);
  },

  finalizeBundleSession: async ({ bundleSessionId, buyerId }) => {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.bundleExecutionSession.findUnique({
        where: { id: bundleSessionId },
      });

      if (!existing) {
        throw gatewayError("NOT_FOUND", "Bundle session was not found.");
      }

      if (existing.buyerId !== buyerId) {
        throw gatewayError("FORBIDDEN", "Bundle session does not belong to this buyer.");
      }

      if (existing.status === "FINALIZED") {
        return loadFinalizedResult(tx, bundleSessionId, existing);
      }

      if (existing.status !== "REGISTERED") {
        throw gatewayError(
          "CONFLICT",
          `Bundle session is ${existing.status.toLowerCase()} and cannot be finalized.`,
        );
      }

      if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
        await tx.bundleExecutionSession.update({
          where: { id: bundleSessionId },
          data: { status: "EXPIRED" },
        });
        throw gatewayError("CONFLICT", "Bundle session has expired.");
      }

      const claimed = await tx.bundleExecutionSession.updateMany({
        where: {
          id: bundleSessionId,
          buyerId,
          status: "REGISTERED",
        },
        data: {
          status: "IN_PROGRESS",
        },
      });

      if (claimed.count !== 1) {
        const latest = await tx.bundleExecutionSession.findUnique({ where: { id: bundleSessionId } });
        if (latest?.status === "FINALIZED") {
          return loadFinalizedResult(tx, bundleSessionId, latest);
        }
        throw gatewayError("CONFLICT", "Bundle session is being finalized by another request.");
      }

      const session = await tx.bundleExecutionSession.findUnique({
        where: { id: bundleSessionId },
      });
      if (!session) {
        throw gatewayError("NOT_FOUND", "Bundle session was not found.");
      }

      const rawStepTxs = await tx.transaction.findMany({
        where: {
          bundleSessionId,
          buyerId,
          billingMode: "BUNDLE_STEP",
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        include: {
          listing: {
            select: {
              id: true,
              slug: true,
              providerId: true,
            },
          },
        },
        orderBy: [
          { bundleStepIndex: "asc" },
          { createdAt: "desc" },
        ],
      });

      const selectedByStep = new Map<number, (typeof rawStepTxs)[number]>();
      const staleTransactionIds: string[] = [];

      for (const txRow of rawStepTxs) {
        const stepIndex = txRow.bundleStepIndex;
        if (typeof stepIndex !== "number" || stepIndex < 0) {
          staleTransactionIds.push(txRow.id);
          continue;
        }
        if (selectedByStep.has(stepIndex)) {
          staleTransactionIds.push(txRow.id);
          continue;
        }
        selectedByStep.set(stepIndex, txRow);
      }

      const selected = Array.from(selectedByStep.values()).sort(
        (a, b) => (a.bundleStepIndex ?? 0) - (b.bundleStepIndex ?? 0),
      );

      if (staleTransactionIds.length > 0) {
        await tx.transaction.updateMany({
          where: { id: { in: staleTransactionIds } },
          data: { status: "FAILED" },
        });
      }

      const executedGrossPriceUsdc = roundUsdc(
        selected.reduce(
          (sum, txRow) =>
            sum + decimalToNumber(txRow.quotedPriceUsdc ?? txRow.priceUsdc),
          0,
        ),
      );

      const registeredGross = decimalToNumber(session.registeredGrossPriceUsdc);
      const targetBundlePrice = decimalToNumber(session.targetBundlePriceUsdc);
      const baseDiscountPct =
        registeredGross > 0
          ? clamp((registeredGross - targetBundlePrice) / registeredGross, 0, 0.95)
          : 0;

      const billedPriceUsdc = roundUsdc(executedGrossPriceUsdc * (1 - baseDiscountPct));
      const platformFeeRate = decimalToNumber(session.platformFeeRate);
      const platformFeeUsdc = roundUsdc(billedPriceUsdc * platformFeeRate);
      const providerPoolUsdc = roundUsdc(billedPriceUsdc - platformFeeUsdc);
      const discountUsdc = roundUsdc(executedGrossPriceUsdc - billedPriceUsdc);

      if (billedPriceUsdc > 0) {
        const debitAmount = toUsdcDecimal(billedPriceUsdc);
        const debited = await tx.wallet.updateMany({
          where: {
            userId: buyerId,
            balanceUsdc: { gte: debitAmount },
          },
          data: {
            balanceUsdc: { decrement: debitAmount },
          },
        });

        if (debited.count !== 1) {
          throw gatewayError(
            "INSUFFICIENT_FUNDS",
            `Insufficient wallet balance to settle bundle charge of $${billedPriceUsdc.toFixed(6)} USDC.`,
          );
        }
      }

      const allocations: BundleSessionFinalizeResult["allocations"] = [];

      if (selected.length > 0) {
        let remainingBilled = billedPriceUsdc;
        let remainingPlatform = platformFeeUsdc;
        let remainingProvider = providerPoolUsdc;

        for (let i = 0; i < selected.length; i++) {
          const txRow = selected[i];
          const isLast = i === selected.length - 1;

          const quotedPriceUsdc = roundUsdc(
            decimalToNumber(txRow.quotedPriceUsdc ?? txRow.priceUsdc),
          );
          const weight =
            executedGrossPriceUsdc > 0
              ? quotedPriceUsdc / executedGrossPriceUsdc
              : 1 / selected.length;

          let allocatedPriceUsdc: number;
          let allocatedPlatformFeeUsdc: number;
          let allocatedProviderAmountUsdc: number;

          if (isLast) {
            allocatedPriceUsdc = roundUsdc(remainingBilled);
            allocatedPlatformFeeUsdc = roundUsdc(remainingPlatform);
            allocatedProviderAmountUsdc = roundUsdc(remainingProvider);
          } else {
            allocatedPriceUsdc = roundUsdc(billedPriceUsdc * weight);
            allocatedPlatformFeeUsdc = roundUsdc(platformFeeUsdc * weight);
            allocatedProviderAmountUsdc = roundUsdc(providerPoolUsdc * weight);
          }

          remainingBilled = roundUsdc(remainingBilled - allocatedPriceUsdc);
          remainingPlatform = roundUsdc(remainingPlatform - allocatedPlatformFeeUsdc);
          remainingProvider = roundUsdc(remainingProvider - allocatedProviderAmountUsdc);

          allocations.push({
            transactionId: txRow.id,
            listingId: txRow.listingId,
            listingSlug: txRow.listing.slug,
            providerId: txRow.listing.providerId,
            bundleStepIndex: txRow.bundleStepIndex ?? i,
            quotedPriceUsdc,
            weight: roundWeight(weight),
            allocatedPriceUsdc,
            platformFeeUsdc: allocatedPlatformFeeUsdc,
            providerAmountUsdc: allocatedProviderAmountUsdc,
          });
        }
      }

      if (allocations.length > 0) {
        for (const allocation of allocations) {
          await tx.transaction.update({
            where: { id: allocation.transactionId },
            data: {
              status: "CONFIRMED",
              settledViaBundle: true,
              settledAt: new Date(),
              priceUsdc: toUsdcDecimal(allocation.allocatedPriceUsdc),
              platformFeeUsdc: toUsdcDecimal(allocation.platformFeeUsdc),
              providerAmountUsdc: toUsdcDecimal(allocation.providerAmountUsdc),
              feeRateApplied: new Prisma.Decimal(platformFeeRate.toFixed(4)),
            },
          });
        }

        const usedTransactionIds = allocations.map((a) => a.transactionId);
        await tx.transaction.updateMany({
          where: {
            bundleSessionId,
            billingMode: "BUNDLE_STEP",
            status: "PENDING",
            id: { notIn: usedTransactionIds },
          },
          data: {
            status: "FAILED",
          },
        });
      }

      await tx.bundleProviderSettlement.deleteMany({
        where: { bundleSessionId },
      });

      if (allocations.length > 0) {
        await tx.bundleProviderSettlement.createMany({
          data: allocations.map((allocation) => ({
            bundleSessionId,
            transactionId: allocation.transactionId,
            providerId: allocation.providerId,
            listingId: allocation.listingId,
            listPriceUsdc: toUsdcDecimal(allocation.quotedPriceUsdc),
            weight: new Prisma.Decimal(allocation.weight.toFixed(8)),
            allocatedPriceUsdc: toUsdcDecimal(allocation.allocatedPriceUsdc),
            platformFeeUsdc: toUsdcDecimal(allocation.platformFeeUsdc),
            providerAmountUsdc: toUsdcDecimal(allocation.providerAmountUsdc),
          })),
        });
      }

      await tx.bundleExecutionSession.update({
        where: { id: bundleSessionId },
        data: {
          status: "FINALIZED",
          executedGrossPriceUsdc: toUsdcDecimal(executedGrossPriceUsdc),
          billedPriceUsdc: toUsdcDecimal(billedPriceUsdc),
          discountUsdc: toUsdcDecimal(discountUsdc),
          platformFeeUsdc: toUsdcDecimal(platformFeeUsdc),
          providerPoolUsdc: toUsdcDecimal(providerPoolUsdc),
          finalizedAt: new Date(),
        },
      });

      return {
        bundleSessionId,
        status: "FINALIZED",
        billedPriceUsdc,
        executedGrossPriceUsdc,
        discountUsdc,
        platformFeeUsdc,
        providerPoolUsdc,
        settlementCount: allocations.length,
        allocations,
      };
    });
  },

  emitDemandSignal: (signal) => {
    console.log("[Gateway] Demand signal:", signal.listingId, signal.type);
  },
};

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const priceWs = new PriceWebSocketServer(redisUrl);

// Redis client for price history queries (separate from pub/sub)
const redisClient = new Redis(redisUrl);

deps.redis = redisClient;
deps.prisma = prisma;

startGateway(deps, undefined, priceWs);

async function loadFinalizedResult(
  tx: Prisma.TransactionClient,
  bundleSessionId: string,
  existingSession?: {
    billedPriceUsdc: Prisma.Decimal;
    executedGrossPriceUsdc: Prisma.Decimal;
    discountUsdc: Prisma.Decimal;
    platformFeeUsdc: Prisma.Decimal;
    providerPoolUsdc: Prisma.Decimal;
  },
): Promise<BundleSessionFinalizeResult> {
  const session =
    existingSession ??
    (await tx.bundleExecutionSession.findUnique({
      where: { id: bundleSessionId },
      select: {
        billedPriceUsdc: true,
        executedGrossPriceUsdc: true,
        discountUsdc: true,
        platformFeeUsdc: true,
        providerPoolUsdc: true,
      },
    }));

  if (!session) {
    throw gatewayError("NOT_FOUND", "Bundle session was not found.");
  }

  const rows = await tx.bundleProviderSettlement.findMany({
    where: { bundleSessionId },
    include: {
      transaction: {
        select: {
          bundleStepIndex: true,
        },
      },
      listing: {
        select: {
          slug: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  rows.sort(
    (a, b) => (a.transaction.bundleStepIndex ?? 0) - (b.transaction.bundleStepIndex ?? 0),
  );

  return {
    bundleSessionId,
    status: "FINALIZED",
    billedPriceUsdc: decimalToNumber(session.billedPriceUsdc),
    executedGrossPriceUsdc: decimalToNumber(session.executedGrossPriceUsdc),
    discountUsdc: decimalToNumber(session.discountUsdc),
    platformFeeUsdc: decimalToNumber(session.platformFeeUsdc),
    providerPoolUsdc: decimalToNumber(session.providerPoolUsdc),
    settlementCount: rows.length,
    allocations: rows.map((row) => ({
      transactionId: row.transactionId,
      listingId: row.listingId,
      listingSlug: row.listing.slug,
      providerId: row.providerId,
      bundleStepIndex: row.transaction.bundleStepIndex ?? 0,
      quotedPriceUsdc: decimalToNumber(row.listPriceUsdc),
      weight: decimalToNumber(row.weight),
      allocatedPriceUsdc: decimalToNumber(row.allocatedPriceUsdc),
      platformFeeUsdc: decimalToNumber(row.platformFeeUsdc),
      providerAmountUsdc: decimalToNumber(row.providerAmountUsdc),
    })),
  };
}

function mapBundleSession(session: {
  id: string;
  buyerId: string;
  apiKeyId: string | null;
  bundleSlug: string;
  bundleName: string | null;
  status: string;
  toolSlugs: string[];
  registeredGrossPriceUsdc: Prisma.Decimal;
  executedGrossPriceUsdc: Prisma.Decimal;
  targetBundlePriceUsdc: Prisma.Decimal;
  billedPriceUsdc: Prisma.Decimal;
  discountUsdc: Prisma.Decimal;
  platformFeeRate: Prisma.Decimal;
  platformFeeUsdc: Prisma.Decimal;
  providerPoolUsdc: Prisma.Decimal;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
}): BundleSessionRecord {
  return {
    id: session.id,
    buyerId: session.buyerId,
    apiKeyId: session.apiKeyId,
    bundleSlug: session.bundleSlug,
    bundleName: session.bundleName,
    status: session.status as BundleSessionRecord["status"],
    toolSlugs: session.toolSlugs,
    registeredGrossPriceUsdc: decimalToNumber(session.registeredGrossPriceUsdc),
    executedGrossPriceUsdc: decimalToNumber(session.executedGrossPriceUsdc),
    targetBundlePriceUsdc: decimalToNumber(session.targetBundlePriceUsdc),
    billedPriceUsdc: decimalToNumber(session.billedPriceUsdc),
    discountUsdc: decimalToNumber(session.discountUsdc),
    platformFeeRate: decimalToNumber(session.platformFeeRate),
    platformFeeUsdc: decimalToNumber(session.platformFeeUsdc),
    providerPoolUsdc: decimalToNumber(session.providerPoolUsdc),
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    finalizedAt: session.finalizedAt,
  };
}

function decimalToNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function toUsdcDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(roundUsdc(value).toFixed(6));
}

function roundUsdc(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundWeight(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gatewayError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  return err;
}
