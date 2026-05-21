// ═══════════════════════════════════════════════════════════════
// NexusX — Quality Scorer Tests
// apps/auction-engine/tests/qualityScorer.test.ts
// ═══════════════════════════════════════════════════════════════

import { QualityScorer, getQualityScorer } from "../src/services/qualityScorer";
import type { RawProviderMetrics } from "../src/services/qualityScorer";

/** A baseline "perfect" provider — all metrics at their best. */
const perfectMetrics = (overrides: Partial<RawProviderMetrics> = {}): RawProviderMetrics => ({
  listingId: "listing-perfect",
  successCount: 10_000,
  failureCount: 0,
  medianLatencyMs: 30,
  p99LatencyMs: 120,
  uptimeMinutes: 43_200, // 30 days
  totalMinutes: 43_200,
  averageRating: 5.0,
  ratingCount: 500,
  ...overrides,
});

/** A baseline "terrible" provider — all metrics at their worst. */
const terribleMetrics = (overrides: Partial<RawProviderMetrics> = {}): RawProviderMetrics => ({
  listingId: "listing-terrible",
  successCount: 100,
  failureCount: 100, // 50% error rate
  medianLatencyMs: 5_000,
  p99LatencyMs: 20_000,
  uptimeMinutes: 38_000, // ~88% uptime
  totalMinutes: 43_200,
  averageRating: 1.0,
  ratingCount: 200,
  ...overrides,
});

describe("QualityScorer", () => {
  const scorer = new QualityScorer();

  describe("composite scoring", () => {
    it("scores a perfect provider near 100", () => {
      const result = scorer.computeQuality(perfectMetrics());
      expect(result.compositeScore).toBeGreaterThan(95);
      expect(result.compositeScore).toBeLessThanOrEqual(100);
    });

    it("scores a terrible provider near 0", () => {
      const result = scorer.computeQuality(terribleMetrics());
      expect(result.compositeScore).toBeLessThan(20);
      expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    });

    it("always keeps the composite score within 0-100", () => {
      const cases = [perfectMetrics(), terribleMetrics(), perfectMetrics({ averageRating: 0 })];
      for (const raw of cases) {
        const { compositeScore } = scorer.computeQuality(raw);
        expect(compositeScore).toBeGreaterThanOrEqual(0);
        expect(compositeScore).toBeLessThanOrEqual(100);
      }
    });

    it("ranks a better provider above a worse one", () => {
      const good = scorer.computeQuality(perfectMetrics());
      const bad = scorer.computeQuality(terribleMetrics());
      expect(good.compositeScore).toBeGreaterThan(bad.compositeScore);
    });
  });

  describe("derived raw metrics", () => {
    it("computes uptime percent from up/total minutes", () => {
      const result = scorer.computeQuality(
        perfectMetrics({ uptimeMinutes: 21_600, totalMinutes: 43_200 }),
      );
      expect(result.uptimePercent).toBeCloseTo(50, 5);
    });

    it("returns 0 uptime when no measurement window exists", () => {
      const result = scorer.computeQuality(perfectMetrics({ totalMinutes: 0 }));
      expect(result.uptimePercent).toBe(0);
    });

    it("computes error rate from success/failure counts", () => {
      const result = scorer.computeQuality(
        perfectMetrics({ successCount: 90, failureCount: 10 }),
      );
      expect(result.errorRatePercent).toBeCloseTo(10, 5);
    });

    it("returns 0 error rate when there is no traffic", () => {
      const result = scorer.computeQuality(
        perfectMetrics({ successCount: 0, failureCount: 0 }),
      );
      expect(result.errorRatePercent).toBe(0);
    });
  });

  describe("rating confidence (Bayesian)", () => {
    it("trusts a high rating more when it has more votes", () => {
      const fewVotes = scorer.computeQuality(perfectMetrics({ ratingCount: 2 }));
      const manyVotes = scorer.computeQuality(perfectMetrics({ ratingCount: 500 }));
      // Same 5.0 rating, but 500 votes should pull the composite higher.
      expect(manyVotes.compositeScore).toBeGreaterThan(fewVotes.compositeScore);
    });
  });

  describe("batch + singleton", () => {
    it("computes a batch of metrics", () => {
      const results = scorer.computeBatch([perfectMetrics(), terribleMetrics()]);
      expect(results).toHaveLength(2);
      expect(results[0].compositeScore).toBeGreaterThan(results[1].compositeScore);
    });

    it("getQualityScorer returns a stable singleton", () => {
      expect(getQualityScorer()).toBe(getQualityScorer());
    });
  });
});
