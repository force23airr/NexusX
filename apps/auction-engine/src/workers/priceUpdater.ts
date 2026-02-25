// ═══════════════════════════════════════════════════════════════
// NexusX — Price Updater Worker
// apps/auction-engine/src/workers/priceUpdater.ts
//
// Periodic worker that:
//   1. Fetches all active listings from the database
//   2. Gathers demand, quality, and supply state for each
//   3. Runs the pricing engine batch computation
//   4. Publishes changed prices to Redis (nexusx:prices channel)
//   5. Persists updated prices back to the database
//
// Only publishes when a price actually changed — no spam.
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { getPricingEngine } from "../services/pricingEngine";
import { GROWTH_CONFIG } from "../config/weights";
import type {
  AuctionResult,
  DemandState,
  QualityMetrics,
  SupplyState,
} from "../../../../packages/types/src/auction";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface PriceTickMessage {
  slug: string;
  name: string;
  listingId: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  timestamp: number;
  // Enriched fields for agent trajectory awareness
  multipliers: {
    demand: number;
    scarcity: number;
    quality: number;
    momentum: number;
    temporal: number;
    combined: number;
  };
  demandScore: number;
  demandVelocity: number;
}

/** Entry stored in Redis sorted set for price history queries. */
interface PriceHistoryEntry {
  price: number;
  floor: number;
  multipliers: {
    demand: number;
    scarcity: number;
    quality: number;
    momentum: number;
    temporal: number;
    combined: number;
  };
  demand: { score: number; velocity: number };
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────
// PRICE UPDATER
// ─────────────────────────────────────────────────────────────

export class PriceUpdater {
  private prisma: PrismaClient;
  private redis: Redis;
  private pricingEngine = getPricingEngine(GROWTH_CONFIG);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(prisma: PrismaClient, redisUrl: string) {
    this.prisma = prisma;
    this.redis = new Redis(redisUrl, { lazyConnect: true });
  }

  async start(): Promise<void> {
    await this.redis.connect();
    console.log("[PriceUpdater] Connected to Redis for publishing.");

    this.running = true;
    // Run immediately on start, then at the configured interval.
    await this.runCycle();
    this.intervalHandle = setInterval(
      () => this.runCycle(),
      GROWTH_CONFIG.updateIntervalMs,
    );
    console.log(
      `[PriceUpdater] Started — updating every ${GROWTH_CONFIG.updateIntervalMs / 1000}s`,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.redis.quit();
    console.log("[PriceUpdater] Stopped.");
  }

  // ─── Main Cycle ───

  private async runCycle(): Promise<void> {
    if (!this.running) return;

    try {
      const startMs = Date.now();

      // 1. Fetch all active listings
      const listings = await this.prisma.listing.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          slug: true,
          name: true,
          currentPriceUsdc: true,
          floorPriceUsdc: true,
          ceilingPriceUsdc: true,
          categoryId: true,
          capacityPerMinute: true,
        },
      });

      if (listings.length === 0) return;

      // 2. Gather state for each listing
      const batchInput = await Promise.all(
        listings.map(async (listing) => {
          const [demand, quality, supply] = await Promise.all([
            this.getDemandState(listing.id),
            this.getQualityMetrics(listing.id),
            this.getSupplyState(listing.id, listing.categoryId, listing.capacityPerMinute),
          ]);

          return {
            listingId: listing.id,
            floorPrice: listing.floorPriceUsdc.toNumber(),
            ceilingPrice: listing.ceilingPriceUsdc?.toNumber() ?? null,
            demand,
            quality,
            supply,
            previousPrice: listing.currentPriceUsdc.toNumber(),
          };
        }),
      );

      // 3. Compute new prices
      const results = this.pricingEngine.computeBatch(batchInput);

      // 4. Publish changes and persist
      let updatedCount = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const listing = listings[i];
        const previousPrice = listing.currentPriceUsdc.toNumber();

        // Only act if price actually changed
        if (result.price === previousPrice) continue;

        updatedCount++;
        const changePercent =
          previousPrice > 0
            ? ((result.price - previousPrice) / previousPrice) * 100
            : 0;

        const now = Date.now();
        const roundedChangePercent = Math.round(changePercent * 100) / 100;

        // Publish enriched tick to Redis pub/sub (real-time stream)
        const tick: PriceTickMessage = {
          slug: listing.slug,
          name: listing.name,
          listingId: listing.id,
          currentPrice: result.price,
          previousPrice,
          changePercent: roundedChangePercent,
          direction: changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat",
          timestamp: now,
          multipliers: result.multipliers,
          demandScore: result.inputs.demand.score,
          demandVelocity: result.inputs.demand.velocity,
        };
        await this.redis.publish("nexusx:prices", JSON.stringify(tick));

        // Persist current price to listing (critical path)
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { currentPriceUsdc: result.price },
        });

        // Persist snapshot + auction result + Redis history (non-critical)
        await this.persistHistory(listing, result, previousPrice, roundedChangePercent, now);
      }

      const elapsed = Date.now() - startMs;
      if (updatedCount > 0) {
        console.log(
          `[PriceUpdater] Cycle complete: ${updatedCount}/${listings.length} prices updated in ${elapsed}ms`,
        );
      }
    } catch (err) {
      console.error("[PriceUpdater] Cycle error:", err);
    }
  }

  // ─── History Persistence ───

  /**
   * Persist price snapshot, auction result, and Redis history entry.
   * Wrapped in try/catch — a missing snapshot is acceptable,
   * a missed price update is not.
   */
  private async persistHistory(
    listing: { id: string; slug: string; floorPriceUsdc: { toNumber(): number }; ceilingPriceUsdc: { toNumber(): number } | null },
    result: AuctionResult,
    previousPrice: number,
    changePercent: number,
    timestamp: number,
  ): Promise<void> {
    try {
      const floorNum = listing.floorPriceUsdc.toNumber();
      const ceilingNum = listing.ceilingPriceUsdc?.toNumber() ?? null;

      // 1. Persist PriceSnapshot to database
      await this.prisma.priceSnapshot.create({
        data: {
          listingId: listing.id,
          floorPrice: floorNum,
          ceilingPrice: ceilingNum,
          currentPrice: result.price,
          previousPrice,
          priceChangePct: changePercent,
          demandMultiplier: result.multipliers.demand,
          scarcityMultiplier: result.multipliers.scarcity,
          qualityMultiplier: result.multipliers.quality,
          momentumMultiplier: result.multipliers.momentum,
          temporalMultiplier: result.multipliers.temporal,
          combinedMultiplier: result.multipliers.combined,
          windowsAtFloor: result.price === floorNum ? 1 : 0,
          windowsAtCeiling: ceilingNum !== null && result.price === ceilingNum ? 1 : 0,
          computedAt: new Date(timestamp),
        },
      });

      // 2. Persist AuctionResult to database
      await this.prisma.auctionResult.create({
        data: {
          listingId: listing.id,
          price: result.price,
          floorPrice: result.floorPrice,
          multipliers: result.multipliers as object,
          inputs: result.inputs as object,
          computeTimeUs: result.computeTimeUs,
          computedAt: new Date(timestamp),
        },
      });

      // 3. Push to Redis sorted set for fast history queries
      const historyKey = `nexusx:price_history:${listing.slug}`;
      const entry: PriceHistoryEntry = {
        price: result.price,
        floor: floorNum,
        multipliers: result.multipliers,
        demand: {
          score: result.inputs.demand.score,
          velocity: result.inputs.demand.velocity,
        },
        timestamp,
      };
      await this.redis.zadd(historyKey, timestamp, JSON.stringify(entry));

      // Trim to last 24 hours
      const cutoff = timestamp - 24 * 60 * 60 * 1000;
      await this.redis.zremrangebyscore(historyKey, 0, cutoff);
    } catch (err) {
      // Non-critical — log and continue
      console.error("[PriceUpdater] Failed to persist history:", err);
    }
  }

  // ─── State Gathering ───

  private async getDemandState(listingId: string): Promise<DemandState> {
    // Aggregate demand signals from the last window
    const windowStart = new Date(Date.now() - GROWTH_CONFIG.demandWindowMs);
    const signals = await this.prisma.demandSignal.findMany({
      where: {
        listingId,
        timestamp: { gte: windowStart },
      },
    });

    const rawSignalSum = signals.reduce(
      (sum, s) => sum + s.weight.toNumber(),
      0,
    );
    const uniqueBuyers = new Set(signals.map((s) => s.buyerId)).size;

    // Normalize to 0-100 score (100 signals at weight 1.0 = score 100)
    const score = Math.min(100, (rawSignalSum / 100) * 100);

    // Simple velocity: count signals in first half vs second half of window
    const midpoint = new Date(
      Date.now() - GROWTH_CONFIG.demandWindowMs / 2,
    );
    const firstHalf = signals.filter((s) => s.timestamp < midpoint).length;
    const secondHalf = signals.filter((s) => s.timestamp >= midpoint).length;
    const velocity = secondHalf - firstHalf;

    return {
      listingId,
      score,
      rawSignalSum,
      uniqueBuyers,
      velocity,
      computedAt: Date.now(),
      windowMs: GROWTH_CONFIG.demandWindowMs,
    };
  }

  private async getQualityMetrics(listingId: string): Promise<QualityMetrics> {
    // Fetch from the quality_metrics table or compute from transaction history
    const metrics = await this.prisma.qualityMetric.findUnique({
      where: { listingId },
    });

    if (metrics) {
      return {
        listingId,
        uptimePercent: metrics.uptimePercent.toNumber(),
        medianLatencyMs: metrics.medianLatencyMs.toNumber(),
        p99LatencyMs: metrics.p99LatencyMs.toNumber(),
        errorRatePercent: metrics.errorRatePercent.toNumber(),
        averageRating: metrics.averageRating.toNumber(),
        ratingCount: metrics.ratingCount,
        compositeScore: metrics.compositeScore.toNumber(),
        computedAt: Date.now(),
      };
    }

    // Default metrics for listings with no data yet
    return {
      listingId,
      uptimePercent: 99.9,
      medianLatencyMs: 100,
      p99LatencyMs: 500,
      errorRatePercent: 0.5,
      averageRating: 4.0,
      ratingCount: 0,
      compositeScore: 70,
      computedAt: Date.now(),
    };
  }

  private async getSupplyState(
    listingId: string,
    categoryId: string,
    capacityPerMinute: number,
  ): Promise<SupplyState> {
    // Count competitors in the same category
    const competitorCount = await this.prisma.listing.count({
      where: {
        categoryId,
        status: "ACTIVE",
        id: { not: listingId },
      },
    });

    // Estimate utilization from recent transactions (last 1 minute)
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentCalls = await this.prisma.transaction.count({
      where: {
        listingId,
        createdAt: { gte: oneMinuteAgo },
      },
    });
    const utilizationPercent = Math.min(
      100,
      (recentCalls / Math.max(1, capacityPerMinute)) * 100,
    );

    return {
      listingId,
      categoryId,
      competitorCount,
      isUnique: competitorCount === 0,
      capacityPerMinute,
      utilizationPercent,
      computedAt: Date.now(),
    };
  }
}
