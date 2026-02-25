// ═══════════════════════════════════════════════════════════════
// NexusX — Price History Route
// apps/gateway/src/routes/price-history.ts
//
// GET /prices/:slug/history — Public endpoint for agents and
// frontends to query price trajectory with trend signals.
//
// Data sources:
//   1. Redis sorted set (fast, last 24h)
//   2. Prisma PriceSnapshot (fallback, any period)
// ═══════════════════════════════════════════════════════════════

import { Router } from "express";
import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { ReliabilityAggregator } from "../services/reliability-aggregator";

/** Minimal Redis interface for sorted set queries. */
interface RedisClient {
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface HistoryPoint {
  timestamp: number;
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
  demandScore: number;
  demandVelocity: number;
}

interface TrendAnalysis {
  direction: "rising_fast" | "rising" | "stable" | "falling" | "falling_fast";
  priceChange1h: number;
  priceChange6h: number | null;
  demandTrend: "accelerating" | "stable" | "decelerating";
  velocityAvg: number;
  support: number;
  resistance: number;
  forecast: string;
}

// ─────────────────────────────────────────────────────────────
// PERIOD CONSTANTS
// ─────────────────────────────────────────────────────────────

const PERIOD_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const RESOLUTION_MS: Record<string, number> = {
  raw: 0,
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
};

// ─────────────────────────────────────────────────────────────
// ROUTE FACTORY
// ─────────────────────────────────────────────────────────────

export function createPriceHistoryRoutes(
  redis: RedisClient,
  prisma: PrismaClient,
  reliabilityAggregator?: ReliabilityAggregator,
): Router {
  const router = Router();

  // ─── Reliability endpoint ───
  router.get("/reliability/:slug", async (req: Request, res: Response) => {
    const slug = req.params.slug as string;

    if (!reliabilityAggregator) {
      res.status(503).json({ error: "Reliability scoring not available" });
      return;
    }

    try {
      const score = await reliabilityAggregator.getScore(slug);
      if (!score) {
        res.json({ slug, reliability: null, message: "No call data recorded yet" });
        return;
      }

      res.json({ slug, reliability: score });
    } catch (err) {
      console.error("[Reliability] Error:", err);
      res.status(500).json({ error: "Failed to compute reliability score" });
    }
  });

  router.get("/prices/:slug/history", async (req: Request, res: Response) => {
    const slug = req.params.slug as string;
    const period = String(req.query.period || "1h");
    const resolution = String(req.query.resolution || "1m");

    if (!PERIOD_MS[period]) {
      res.status(400).json({ error: "Invalid period. Use: 1h, 6h, 24h" });
      return;
    }
    if (!RESOLUTION_MS.hasOwnProperty(resolution)) {
      res.status(400).json({ error: "Invalid resolution. Use: raw, 1m, 5m, 15m" });
      return;
    }

    try {
      const now = Date.now();
      const cutoff = now - PERIOD_MS[period];

      // Try Redis sorted set first (fast path, up to 24h)
      let points = await fetchFromRedis(redis, slug, cutoff, now);

      // Fall back to Prisma if Redis has no data
      if (points.length === 0) {
        points = await fetchFromPrisma(prisma, slug, cutoff);
      }

      // Downsample if resolution != raw
      const resMs = RESOLUTION_MS[resolution];
      const sampled = resMs > 0 ? downsample(points, resMs) : points;

      // Compute trend analysis
      const trend = computeTrend(points, period);

      res.json({
        slug,
        period,
        resolution,
        pointCount: sampled.length,
        points: sampled,
        trend,
      });
    } catch (err) {
      console.error("[PriceHistory] Error:", err);
      res.status(500).json({ error: "Failed to fetch price history" });
    }
  });

  return router;
}

// ─────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────

async function fetchFromRedis(
  redis: RedisClient,
  slug: string,
  cutoff: number,
  now: number,
): Promise<HistoryPoint[]> {
  const key = `nexusx:price_history:${slug}`;
  const raw = await redis.zrangebyscore(key, cutoff, now);

  return raw.map((entry: string) => {
    const parsed = JSON.parse(entry);
    return {
      timestamp: parsed.timestamp,
      price: parsed.price,
      floor: parsed.floor,
      multipliers: parsed.multipliers,
      demandScore: parsed.demand?.score ?? 0,
      demandVelocity: parsed.demand?.velocity ?? 0,
    };
  });
}

async function fetchFromPrisma(
  prisma: PrismaClient,
  slug: string,
  cutoff: number,
): Promise<HistoryPoint[]> {
  const listing = await prisma.listing.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!listing) return [];

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      listingId: listing.id,
      computedAt: { gte: new Date(cutoff) },
    },
    orderBy: { computedAt: "asc" },
  });

  return snapshots.map((s) => ({
    timestamp: s.computedAt.getTime(),
    price: Number(s.currentPrice),
    floor: Number(s.floorPrice),
    multipliers: {
      demand: Number(s.demandMultiplier),
      scarcity: Number(s.scarcityMultiplier),
      quality: Number(s.qualityMultiplier),
      momentum: Number(s.momentumMultiplier),
      temporal: Number(s.temporalMultiplier),
      combined: Number(s.combinedMultiplier),
    },
    demandScore: 0,
    demandVelocity: 0,
  }));
}

// ─────────────────────────────────────────────────────────────
// DOWNSAMPLING
// ─────────────────────────────────────────────────────────────

function downsample(points: HistoryPoint[], intervalMs: number): HistoryPoint[] {
  if (points.length === 0) return [];

  const buckets: HistoryPoint[] = [];
  let bucketStart = points[0].timestamp;
  let bucketPoints: HistoryPoint[] = [];

  for (const p of points) {
    if (p.timestamp - bucketStart >= intervalMs && bucketPoints.length > 0) {
      // Take the last point in each bucket (most recent)
      buckets.push(bucketPoints[bucketPoints.length - 1]);
      bucketStart = p.timestamp;
      bucketPoints = [p];
    } else {
      bucketPoints.push(p);
    }
  }

  // Don't forget the last bucket
  if (bucketPoints.length > 0) {
    buckets.push(bucketPoints[bucketPoints.length - 1]);
  }

  return buckets;
}

// ─────────────────────────────────────────────────────────────
// TREND COMPUTATION
// ─────────────────────────────────────────────────────────────

function computeTrend(points: HistoryPoint[], period: string): TrendAnalysis {
  if (points.length < 2) {
    return {
      direction: "stable",
      priceChange1h: 0,
      priceChange6h: null,
      demandTrend: "stable",
      velocityAvg: 0,
      support: points[0]?.price ?? 0,
      resistance: points[0]?.price ?? 0,
      forecast: "Insufficient data for trend analysis",
    };
  }

  const latest = points[points.length - 1];
  const prices = points.map((p) => p.price);
  const support = Math.min(...prices);
  const resistance = Math.max(...prices);

  // Price change over the full period
  const first = points[0];
  const fullChange = first.price > 0
    ? ((latest.price - first.price) / first.price) * 100
    : 0;

  // Price change over last hour (find point closest to 1h ago)
  const oneHourAgo = latest.timestamp - 60 * 60 * 1000;
  const hourPoint = findClosest(points, oneHourAgo);
  const priceChange1h = hourPoint && hourPoint.price > 0
    ? ((latest.price - hourPoint.price) / hourPoint.price) * 100
    : fullChange;

  // Price change over last 6h if period is long enough
  let priceChange6h: number | null = null;
  if (period === "6h" || period === "24h") {
    const sixHoursAgo = latest.timestamp - 6 * 60 * 60 * 1000;
    const sixHrPoint = findClosest(points, sixHoursAgo);
    if (sixHrPoint && sixHrPoint.price > 0) {
      priceChange6h = ((latest.price - sixHrPoint.price) / sixHrPoint.price) * 100;
    }
  }

  // Direction classification
  const direction = classifyDirection(priceChange1h);

  // Demand velocity trend
  const velocities = points.filter((p) => p.demandVelocity !== undefined).map((p) => p.demandVelocity);
  const velocityAvg = velocities.length > 0
    ? velocities.reduce((a, b) => a + b, 0) / velocities.length
    : 0;

  // Compare recent velocity to earlier velocity
  const recentVelocities = velocities.slice(-Math.ceil(velocities.length / 3));
  const earlyVelocities = velocities.slice(0, Math.ceil(velocities.length / 3));
  const recentAvg = avg(recentVelocities);
  const earlyAvg = avg(earlyVelocities);
  const demandTrend: "accelerating" | "stable" | "decelerating" =
    recentAvg > earlyAvg + 0.5 ? "accelerating" :
    recentAvg < earlyAvg - 0.5 ? "decelerating" :
    "stable";

  // Forecast
  const forecast = generateForecast(direction, demandTrend, latest, velocityAvg);

  return {
    direction,
    priceChange1h: round2(priceChange1h),
    priceChange6h: priceChange6h !== null ? round2(priceChange6h) : null,
    demandTrend,
    velocityAvg: round2(velocityAvg),
    support: round6(support),
    resistance: round6(resistance),
    forecast,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function classifyDirection(changePercent: number): TrendAnalysis["direction"] {
  if (changePercent > 5) return "rising_fast";
  if (changePercent > 1) return "rising";
  if (changePercent < -5) return "falling_fast";
  if (changePercent < -1) return "falling";
  return "stable";
}

function generateForecast(
  direction: TrendAnalysis["direction"],
  demandTrend: TrendAnalysis["demandTrend"],
  _latest: HistoryPoint,
  velocityAvg: number,
): string {
  if (direction === "rising_fast" && demandTrend === "accelerating") {
    return "Price rising rapidly with accelerating demand. Execute now to avoid higher costs in upcoming auction cycles.";
  }
  if (direction === "rising" && demandTrend === "accelerating") {
    return "Price trending up with increasing demand. Consider executing soon — price likely to continue rising.";
  }
  if (direction === "rising" && demandTrend === "stable") {
    return "Price trending up with steady demand. Moderate urgency to execute.";
  }
  if (direction === "falling" || direction === "falling_fast") {
    return "Price declining. Consider waiting for a lower price unless immediate execution is required.";
  }
  if (demandTrend === "accelerating" && velocityAvg > 1.5) {
    return "Demand accelerating — price may increase soon. Execute now for best rate.";
  }
  if (demandTrend === "decelerating") {
    return "Demand cooling off. Price may decrease — waiting could save costs.";
  }
  return "Price stable. No significant urgency — execute at your convenience.";
}

function findClosest(points: HistoryPoint[], targetTs: number): HistoryPoint | null {
  if (points.length === 0) return null;
  let closest = points[0];
  let minDiff = Math.abs(points[0].timestamp - targetTs);
  for (const p of points) {
    const diff = Math.abs(p.timestamp - targetTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return closest;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
