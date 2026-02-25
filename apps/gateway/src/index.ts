// ═══════════════════════════════════════════════════════════════
// NexusX — Gateway Entrypoint
// apps/gateway/src/index.ts
//
// Bootstraps the gateway with Prisma-backed dependencies.
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { startGateway } from "./server";
import type { GatewayDependencies } from "./server";
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
      currentPriceUsdc: listing.currentPriceUsdc.toNumber(),
      floorPriceUsdc: listing.floorPriceUsdc.toNumber(),
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
      currentPriceUsdc: listing.currentPriceUsdc.toNumber(),
      floorPriceUsdc: listing.floorPriceUsdc.toNumber(),
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
        priceUsdc: record.priceUsdc,
        platformFeeUsdc: record.platformFeeUsdc,
        providerAmountUsdc: record.providerAmountUsdc,
        feeRateApplied: record.feeRateApplied,
        responseTimeMs: record.responseTimeMs,
        httpStatus: record.httpStatus,
        bytesTransferred: record.bytesTransferred,
        status: "CONFIRMED",
      },
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
