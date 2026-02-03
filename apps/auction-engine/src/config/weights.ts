// ═══════════════════════════════════════════════════════════════
// NexusX — Pricing Engine Configuration Presets
// apps/auction-engine/src/config/weights.ts
//
// Different phases of marketplace growth require different
// pricing behavior. Early-stage needs stability to build trust.
// Growth-stage needs responsiveness to capture value.
// Mature-stage needs precision.
// ═══════════════════════════════════════════════════════════════

import type { PricingConfig } from "../../../../packages/types/src/auction";

/**
 * LAUNCH PHASE (Month 1-3)
 *
 * Conservative pricing. The goal is TRUST, not revenue optimization.
 * Providers need to see predictable, stable prices.
 * Buyers need to feel confident costs won't spike randomly.
 *
 * - Low smoothing factor = prices change very slowly
 * - Low max multipliers = limited price range
 * - Tight rate limiting = small moves per cycle
 */
export const LAUNCH_CONFIG: PricingConfig = {
  updateIntervalMs: 30_000,         // Update every 30 seconds (slow)
  demandWindowMs: 600_000,          // 10-minute demand windows (long)
  maxDemandMultiplier: 1.8,         // Max 1.8x from demand
  maxScarcityMultiplier: 1.4,       // Max 1.4x from scarcity
  maxQualityMultiplier: 1.3,        // Max 1.3x from quality
  maxMomentumMultiplier: 1.1,       // Momentum barely matters
  smoothingFactor: 0.15,            // Very smooth (85% old price)
  maxPriceChangePercent: 5,         // Max 5% change per cycle
  platformFeeRate: 0.10,            // Lower fee to attract providers
};

/**
 * GROWTH PHASE (Month 3-12)
 *
 * Balanced pricing. Enough responsiveness to reward popular
 * providers and capture demand-driven value, but still stable
 * enough that buyers can predict costs.
 *
 * This is the DEFAULT_PRICING_CONFIG from the types package.
 */
export const GROWTH_CONFIG: PricingConfig = {
  updateIntervalMs: 10_000,         // Update every 10 seconds
  demandWindowMs: 300_000,          // 5-minute demand windows
  maxDemandMultiplier: 3.5,         // Demand can 3.5x the floor
  maxScarcityMultiplier: 2.0,       // Scarcity can 2x the floor
  maxQualityMultiplier: 1.5,        // Quality can 1.5x the floor
  maxMomentumMultiplier: 1.3,       // Moderate momentum effect
  smoothingFactor: 0.3,             // 30% new, 70% old
  maxPriceChangePercent: 15,        // Max 15% change per cycle
  platformFeeRate: 0.12,            // Standard 12% take rate
};

/**
 * SCALE PHASE (Month 12+)
 *
 * Aggressive pricing. The marketplace has enough liquidity that
 * prices can be highly responsive to real-time signals. Providers
 * trust the system. Buyers expect dynamic pricing.
 *
 * - Fast updates, short windows, high multipliers
 * - Higher smoothing factor = more responsive to new data
 * - Higher max changes = allows bigger moves when justified
 */
export const SCALE_CONFIG: PricingConfig = {
  updateIntervalMs: 5_000,          // Update every 5 seconds
  demandWindowMs: 120_000,          // 2-minute demand windows (short)
  maxDemandMultiplier: 5.0,         // Demand can 5x the floor
  maxScarcityMultiplier: 2.5,       // Scarcity can 2.5x the floor
  maxQualityMultiplier: 1.8,        // Quality can 1.8x the floor
  maxMomentumMultiplier: 1.5,       // Strong momentum effect
  smoothingFactor: 0.5,             // 50% new, 50% old (very responsive)
  maxPriceChangePercent: 25,        // Max 25% change per cycle
  platformFeeRate: 0.10,            // Lower fee at scale (volume > margin)
};

/**
 * Quality score weights for computing the composite quality score.
 * These define how much each metric contributes to the overall score.
 * Weights must sum to 1.0.
 */
export const QUALITY_WEIGHTS = {
  /** Uptime is king — unreliable APIs are worthless */
  uptime: 0.30,
  /** Latency matters for real-time use cases */
  medianLatency: 0.20,
  /** Error rate directly impacts buyer experience */
  errorRate: 0.20,
  /** Buyer ratings capture subjective quality */
  rating: 0.20,
  /** P99 latency catches tail-end performance issues */
  p99Latency: 0.10,
} as const;

/**
 * Latency benchmarks for quality scoring.
 * Scores are relative to these targets.
 */
export const LATENCY_BENCHMARKS = {
  /** Excellent: sub-50ms median */
  excellent: 50,
  /** Good: sub-200ms median */
  good: 200,
  /** Acceptable: sub-500ms median */
  acceptable: 500,
  /** Poor: anything above 500ms */
  poor: 1000,
} as const;

/**
 * Returns the appropriate config for the current marketplace phase.
 * In production, this would read from a config store / feature flag.
 */
export const getPhaseConfig = (
  phase: "launch" | "growth" | "scale",
): PricingConfig => {
  switch (phase) {
    case "launch":
      return { ...LAUNCH_CONFIG };
    case "growth":
      return { ...GROWTH_CONFIG };
    case "scale":
      return { ...SCALE_CONFIG };
    default:
      return { ...GROWTH_CONFIG };
  }
};
