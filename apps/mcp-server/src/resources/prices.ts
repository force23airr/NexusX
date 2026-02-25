// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Price Resources
// apps/mcp-server/src/resources/prices.ts
//
// Resources:
//   nexusx://prices                — live price ticks from Redis
//   nexusx://prices/history/{slug} — price history + trajectory
// ═══════════════════════════════════════════════════════════════

import type { PriceSubscriber } from "../services/price-subscriber";
import type { PriceHistoryPoint, PriceTrajectory } from "../types";

// ─────────────────────────────────────────────────────────────
// LIVE PRICES RESOURCE
// ─────────────────────────────────────────────────────────────

export function createPricesResourceHandler(priceSubscriber: PriceSubscriber) {
  return async (): Promise<string> => {
    const prices = priceSubscriber.getAllPrices();

    if (prices.length === 0) {
      return JSON.stringify({
        message: "No live price data available. Prices update when the auction engine publishes changes.",
        connected: priceSubscriber.isConnected(),
      });
    }

    const formatted = prices.map((p) => ({
      slug: p.slug,
      name: p.name,
      price: `$${p.currentPrice.toFixed(6)} USDC`,
      previous: `$${p.previousPrice.toFixed(6)} USDC`,
      change: `${p.changePercent > 0 ? "+" : ""}${p.changePercent.toFixed(2)}%`,
      direction: p.direction,
    }));

    return JSON.stringify(formatted, null, 2);
  };
}

// ─────────────────────────────────────────────────────────────
// PRICE HISTORY RESOURCE
// ─────────────────────────────────────────────────────────────

export function createPriceHistoryResourceHandler(priceSubscriber: PriceSubscriber) {
  return async (slug: string): Promise<string> => {
    // Try in-memory history first (sub-millisecond, ~1 hour)
    let points = priceSubscriber.getHistoryBySlug(slug);

    // Fall back to gateway endpoint for longer history
    if (points.length === 0) {
      points = await priceSubscriber.getExtendedHistory(slug, "1h");
    }

    if (points.length === 0) {
      return JSON.stringify({
        slug,
        message: "No price history available for this listing. History accumulates as the auction engine runs.",
        connected: priceSubscriber.isConnected(),
      });
    }

    const trajectory = computeTrajectory(points);
    const latest = points[points.length - 1];
    const earliest = points[0];
    const spanMs = latest.timestamp - earliest.timestamp;

    return JSON.stringify({
      slug,
      pointCount: points.length,
      spanMinutes: Math.round(spanMs / 60_000),
      latest: {
        price: latest.price,
        timestamp: latest.timestamp,
        multipliers: latest.multipliers,
        demandScore: latest.demandScore,
        demandVelocity: latest.demandVelocity,
      },
      trajectory,
      // Include downsampled points (every 6th point ≈ 1-minute intervals)
      points: downsamplePoints(points, 6),
    }, null, 2);
  };
}

// ─────────────────────────────────────────────────────────────
// TRAJECTORY COMPUTATION
// ─────────────────────────────────────────────────────────────

export function computeTrajectory(points: PriceHistoryPoint[]): PriceTrajectory {
  if (points.length < 2) {
    return {
      direction: "stable",
      priceChange5m: 0,
      priceChange15m: 0,
      priceChange1h: 0,
      demandTrend: "stable",
      velocityAvg: 0,
      support: points[0]?.price ?? 0,
      resistance: points[0]?.price ?? 0,
      recommendation: "Insufficient history for trajectory analysis. Execute at current price.",
    };
  }

  const latest = points[points.length - 1];
  const now = latest.timestamp;
  const prices = points.map((p) => p.price);

  // Support & resistance
  const support = Math.min(...prices);
  const resistance = Math.max(...prices);

  // Price changes over different windows
  const priceChange5m = computeChange(points, now, 5 * 60 * 1000);
  const priceChange15m = computeChange(points, now, 15 * 60 * 1000);
  const priceChange1h = computeChange(points, now, 60 * 60 * 1000);

  // Direction classification
  const direction = classifyDirection(priceChange1h);

  // Demand velocity analysis
  const velocities = points
    .filter((p) => p.demandVelocity !== undefined)
    .map((p) => p.demandVelocity!);

  const velocityAvg = velocities.length > 0
    ? velocities.reduce((a, b) => a + b, 0) / velocities.length
    : 0;

  // Compare recent vs earlier velocities for trend
  const third = Math.ceil(velocities.length / 3);
  const recentVelocities = velocities.slice(-third);
  const earlyVelocities = velocities.slice(0, third);
  const recentAvg = avg(recentVelocities);
  const earlyAvg = avg(earlyVelocities);

  const demandTrend: PriceTrajectory["demandTrend"] =
    recentAvg > earlyAvg + 0.5 ? "accelerating" :
    recentAvg < earlyAvg - 0.5 ? "decelerating" :
    "stable";

  // Generate recommendation
  const recommendation = generateRecommendation(direction, demandTrend, velocityAvg, latest);

  return {
    direction,
    priceChange5m: round2(priceChange5m),
    priceChange15m: round2(priceChange15m),
    priceChange1h: round2(priceChange1h),
    demandTrend,
    velocityAvg: round2(velocityAvg),
    support: round6(support),
    resistance: round6(resistance),
    recommendation,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function computeChange(points: PriceHistoryPoint[], now: number, windowMs: number): number {
  const targetTs = now - windowMs;
  const reference = findClosest(points, targetTs);
  const latest = points[points.length - 1];
  if (!reference || reference.price === 0) return 0;
  return ((latest.price - reference.price) / reference.price) * 100;
}

function findClosest(points: PriceHistoryPoint[], targetTs: number): PriceHistoryPoint | null {
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

function classifyDirection(changePercent: number): PriceTrajectory["direction"] {
  if (changePercent > 5) return "rising_fast";
  if (changePercent > 1) return "rising";
  if (changePercent < -5) return "falling_fast";
  if (changePercent < -1) return "falling";
  return "stable";
}

function generateRecommendation(
  direction: PriceTrajectory["direction"],
  demandTrend: PriceTrajectory["demandTrend"],
  velocityAvg: number,
  latest: PriceHistoryPoint,
): string {
  if (direction === "rising_fast" && demandTrend === "accelerating") {
    return "Execute now — price rising rapidly with accelerating demand. Waiting will cost more.";
  }
  if (direction === "rising" && demandTrend === "accelerating") {
    return "Execute soon — price trending up with increasing demand. Likely to continue rising.";
  }
  if (direction === "rising" && demandTrend === "stable") {
    return "Moderate urgency — price rising with steady demand.";
  }
  if (direction === "falling_fast") {
    return "Wait if possible — price declining rapidly. Better rates likely in upcoming cycles.";
  }
  if (direction === "falling") {
    return "Consider waiting — price declining. Lower rates expected soon.";
  }
  if (demandTrend === "accelerating" && velocityAvg > 1.5) {
    return "Execute now — demand accelerating. Price increase likely in next 2-3 auction cycles.";
  }
  if (demandTrend === "decelerating") {
    return "No rush — demand cooling off. Price may decrease in upcoming cycles.";
  }
  return "Stable pricing — execute at your convenience.";
}

function downsamplePoints(points: PriceHistoryPoint[], every: number): PriceHistoryPoint[] {
  if (points.length <= 60) return points; // Already small enough
  return points.filter((_, i) => i % every === 0 || i === points.length - 1);
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
