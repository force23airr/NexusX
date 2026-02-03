// ═══════════════════════════════════════════════════════════════
// NexusX — Quality Scorer
// apps/auction-engine/src/services/qualityScorer.ts
//
// Computes composite quality scores from raw provider metrics.
// The quality score directly influences pricing — higher quality
// providers earn higher prices through the quality multiplier.
//
// This creates a virtuous cycle:
//   Better uptime/latency → Higher quality score →
//   Higher price multiplier → More revenue →
//   More investment in infrastructure → Better uptime/latency
// ═══════════════════════════════════════════════════════════════

import type { QualityMetrics } from "../../../../packages/types/src/auction";
import { QUALITY_WEIGHTS, LATENCY_BENCHMARKS } from "../config/weights";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** Raw metrics collected from the gateway's monitoring system */
export interface RawProviderMetrics {
  listingId: string;
  /** Total successful responses in the measurement period */
  successCount: number;
  /** Total failed responses (5xx, timeouts) in the period */
  failureCount: number;
  /** Median response time in ms */
  medianLatencyMs: number;
  /** 99th percentile response time in ms */
  p99LatencyMs: number;
  /** Total minutes the endpoint was reachable in trailing 30 days */
  uptimeMinutes: number;
  /** Total minutes in the trailing 30-day measurement window */
  totalMinutes: number;
  /** Average buyer rating (1.0-5.0) */
  averageRating: number;
  /** Number of ratings received */
  ratingCount: number;
}

// ─────────────────────────────────────────────
// Quality Scorer
// ─────────────────────────────────────────────

export class QualityScorer {
  /**
   * Compute the full quality metrics from raw provider data.
   * Returns a QualityMetrics object ready to feed into the pricing engine.
   */
  computeQuality(raw: RawProviderMetrics): QualityMetrics {
    const uptimePercent = this.computeUptimeScore(raw);
    const errorRatePercent = this.computeErrorRate(raw);

    // Compute individual dimension scores (all normalized to 0-100)
    const uptimeScore = this.scoreUptime(uptimePercent);
    const latencyScore = this.scoreLatency(raw.medianLatencyMs);
    const p99Score = this.scoreP99Latency(raw.p99LatencyMs);
    const errorScore = this.scoreErrorRate(errorRatePercent);
    const ratingScore = this.scoreRating(raw.averageRating, raw.ratingCount);

    // Weighted composite
    const compositeScore = Math.round(
      uptimeScore * QUALITY_WEIGHTS.uptime +
      latencyScore * QUALITY_WEIGHTS.medianLatency +
      errorScore * QUALITY_WEIGHTS.errorRate +
      ratingScore * QUALITY_WEIGHTS.rating +
      p99Score * QUALITY_WEIGHTS.p99Latency
    );

    return {
      listingId: raw.listingId,
      uptimePercent,
      medianLatencyMs: raw.medianLatencyMs,
      p99LatencyMs: raw.p99LatencyMs,
      errorRatePercent,
      averageRating: raw.averageRating,
      ratingCount: raw.ratingCount,
      compositeScore: Math.min(100, Math.max(0, compositeScore)),
      computedAt: Date.now(),
    };
  }

  /**
   * Batch compute quality for multiple listings.
   */
  computeBatch(rawMetrics: RawProviderMetrics[]): QualityMetrics[] {
    return rawMetrics.map((raw) => this.computeQuality(raw));
  }

  // ─────────────────────────────────────────
  // Raw metric computations
  // ─────────────────────────────────────────

  private computeUptimeScore(raw: RawProviderMetrics): number {
    if (raw.totalMinutes === 0) return 0;
    return (raw.uptimeMinutes / raw.totalMinutes) * 100;
  }

  private computeErrorRate(raw: RawProviderMetrics): number {
    const total = raw.successCount + raw.failureCount;
    if (total === 0) return 0;
    return (raw.failureCount / total) * 100;
  }

  // ─────────────────────────────────────────
  // Scoring functions (raw metric → 0-100)
  //
  // Each function maps a raw metric to a normalized
  // 0-100 score using domain-appropriate curves.
  // ─────────────────────────────────────────

  /**
   * Uptime scoring.
   * Uses a steep exponential curve because the difference between
   * 99.9% and 99.0% uptime is massive (8.7 hours vs 87 hours downtime/year).
   *
   *   99.99% → 100
   *   99.9%  → 95
   *   99.5%  → 80
   *   99.0%  → 60
   *   98.0%  → 30
   *   <95%   → 0
   */
  private scoreUptime(uptimePercent: number): number {
    if (uptimePercent >= 99.99) return 100;
    if (uptimePercent >= 99.95) return 97;
    if (uptimePercent >= 99.9) return 95;
    if (uptimePercent >= 99.5) return 80;
    if (uptimePercent >= 99.0) return 60;
    if (uptimePercent >= 98.0) return 30;
    if (uptimePercent >= 95.0) return 10;
    return 0;
  }

  /**
   * Median latency scoring.
   * Lower is better. Scoring based on benchmarks.
   *
   *   <50ms  → 100 (excellent)
   *   50-200ms → 70-100
   *   200-500ms → 40-70
   *   >500ms → 0-40
   */
  private scoreLatency(medianMs: number): number {
    if (medianMs <= LATENCY_BENCHMARKS.excellent) return 100;
    if (medianMs <= LATENCY_BENCHMARKS.good) {
      // Linear interpolation between excellent and good
      const t = (medianMs - LATENCY_BENCHMARKS.excellent) /
                (LATENCY_BENCHMARKS.good - LATENCY_BENCHMARKS.excellent);
      return Math.round(100 - t * 30); // 100 → 70
    }
    if (medianMs <= LATENCY_BENCHMARKS.acceptable) {
      const t = (medianMs - LATENCY_BENCHMARKS.good) /
                (LATENCY_BENCHMARKS.acceptable - LATENCY_BENCHMARKS.good);
      return Math.round(70 - t * 30); // 70 → 40
    }
    if (medianMs <= LATENCY_BENCHMARKS.poor) {
      const t = (medianMs - LATENCY_BENCHMARKS.acceptable) /
                (LATENCY_BENCHMARKS.poor - LATENCY_BENCHMARKS.acceptable);
      return Math.round(40 - t * 30); // 40 → 10
    }
    return 0;
  }

  /**
   * P99 latency scoring.
   * Same logic as median but with 3x higher thresholds,
   * since P99 is naturally higher.
   */
  private scoreP99Latency(p99Ms: number): number {
    if (p99Ms <= LATENCY_BENCHMARKS.excellent * 3) return 100;
    if (p99Ms <= LATENCY_BENCHMARKS.good * 3) {
      const t = (p99Ms - LATENCY_BENCHMARKS.excellent * 3) /
                (LATENCY_BENCHMARKS.good * 3 - LATENCY_BENCHMARKS.excellent * 3);
      return Math.round(100 - t * 30);
    }
    if (p99Ms <= LATENCY_BENCHMARKS.acceptable * 3) {
      const t = (p99Ms - LATENCY_BENCHMARKS.good * 3) /
                (LATENCY_BENCHMARKS.acceptable * 3 - LATENCY_BENCHMARKS.good * 3);
      return Math.round(70 - t * 30);
    }
    return 10;
  }

  /**
   * Error rate scoring.
   * Lower is better. Very steep curve because even small
   * error rates destroy buyer trust.
   *
   *   0%     → 100
   *   <0.1%  → 95
   *   <0.5%  → 80
   *   <1%    → 60
   *   <5%    → 20
   *   >5%    → 0
   */
  private scoreErrorRate(errorPercent: number): number {
    if (errorPercent <= 0) return 100;
    if (errorPercent < 0.1) return 95;
    if (errorPercent < 0.5) return 80;
    if (errorPercent < 1.0) return 60;
    if (errorPercent < 2.0) return 40;
    if (errorPercent < 5.0) return 20;
    return 0;
  }

  /**
   * Rating scoring.
   * Maps 1-5 star ratings to 0-100.
   * Accounts for rating count — a 5.0 with 2 ratings is less
   * meaningful than a 4.7 with 500 ratings.
   *
   * Uses a confidence-adjusted score:
   *   adjusted = rating × confidence + prior × (1 - confidence)
   * where confidence scales with sqrt(ratingCount).
   */
  private scoreRating(avgRating: number, ratingCount: number): number {
    const prior = 3.5; // Bayesian prior (assume mediocre if no data)
    const confidenceScale = 50; // Number of ratings for ~87% confidence

    // Confidence factor: 0 → 1 as ratingCount grows
    // sqrt scaling means diminishing returns on more ratings
    const confidence = Math.min(1, Math.sqrt(ratingCount) / Math.sqrt(confidenceScale));

    // Bayesian adjusted rating
    const adjustedRating = avgRating * confidence + prior * (1 - confidence);

    // Map 1-5 scale to 0-100
    // 1.0 → 0, 3.0 → 50, 5.0 → 100
    const score = ((adjustedRating - 1) / 4) * 100;

    return Math.round(Math.min(100, Math.max(0, score)));
  }
}

// ─────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────

let instance: QualityScorer | null = null;

export const getQualityScorer = (): QualityScorer => {
  if (!instance) {
    instance = new QualityScorer();
  }
  return instance;
};
