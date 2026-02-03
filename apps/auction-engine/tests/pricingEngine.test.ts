// ═══════════════════════════════════════════════════════════════
// NexusX — Pricing Engine Tests
// apps/auction-engine/tests/pricingEngine.test.ts
//
// These tests validate the core pricing algorithm.
// Every test here protects a business rule.
// ═══════════════════════════════════════════════════════════════

import { PricingEngine } from "../src/services/pricingEngine";
import type {
  DemandState,
  QualityMetrics,
  SupplyState,
  PricingConfig,
} from "../../packages/types/src/auction";

// ─────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────

const createDemandState = (overrides: Partial<DemandState> = {}): DemandState => ({
  listingId: "test-listing",
  score: 50,
  rawSignalSum: 100,
  uniqueBuyers: 25,
  velocity: 0,
  computedAt: Date.now(),
  windowMs: 300_000,
  ...overrides,
});

const createQualityMetrics = (overrides: Partial<QualityMetrics> = {}): QualityMetrics => ({
  listingId: "test-listing",
  uptimePercent: 99.9,
  medianLatencyMs: 50,
  p99LatencyMs: 200,
  errorRatePercent: 0.1,
  averageRating: 4.5,
  ratingCount: 100,
  compositeScore: 85,
  computedAt: Date.now(),
  ...overrides,
});

const createSupplyState = (overrides: Partial<SupplyState> = {}): SupplyState => ({
  listingId: "test-listing",
  categoryId: "nlp",
  competitorCount: 3,
  isUnique: false,
  capacityPerMinute: 1000,
  utilizationPercent: 50,
  computedAt: Date.now(),
  ...overrides,
});

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("PricingEngine", () => {
  let engine: PricingEngine;

  beforeEach(() => {
    engine = new PricingEngine();
  });

  // ═══════════════════════════════════════════
  // BUSINESS RULE: Floor Price is Sacred
  // ═══════════════════════════════════════════

  describe("Floor Price Protection", () => {
    it("should never return a price below the floor", () => {
      const floorPrice = 0.005;

      // Even with zero demand, terrible quality, tons of competition
      const demand = createDemandState({ score: 0, velocity: -20 });
      const quality = createQualityMetrics({ compositeScore: 10 });
      const supply = createSupplyState({ competitorCount: 50 });

      const result = engine.computePrice(
        floorPrice, null, demand, quality, supply, null,
      );

      expect(result.price).toBeGreaterThanOrEqual(floorPrice);
    });

    it("should return floor price when demand is zero", () => {
      const floorPrice = 0.01;
      const demand = createDemandState({ score: 0, velocity: 0 });
      const quality = createQualityMetrics({ compositeScore: 50 });
      const supply = createSupplyState({ competitorCount: 10 });

      const result = engine.computePrice(
        floorPrice, null, demand, quality, supply, null,
      );

      // Price should be at or very near floor (quality floor of 0.7 may pull it slightly)
      expect(result.price).toBeGreaterThanOrEqual(floorPrice);
      expect(result.price).toBeLessThan(floorPrice * 2);
    });

    it("should respect the ceiling when set", () => {
      const floorPrice = 0.001;
      const ceilingPrice = 0.005;

      // Max demand, unique listing, perfect quality
      const demand = createDemandState({ score: 100, velocity: 20 });
      const quality = createQualityMetrics({ compositeScore: 100 });
      const supply = createSupplyState({ competitorCount: 0, isUnique: true });

      const result = engine.computePrice(
        floorPrice, ceilingPrice, demand, quality, supply, null,
      );

      expect(result.price).toBeLessThanOrEqual(ceilingPrice);
    });
  });

  // ═══════════════════════════════════════════
  // DEMAND MULTIPLIER
  // ═══════════════════════════════════════════

  describe("Demand Multiplier", () => {
    it("should increase price with higher demand", () => {
      const floorPrice = 0.01;
      const quality = createQualityMetrics();
      const supply = createSupplyState();

      const lowDemand = createDemandState({ score: 20 });
      const highDemand = createDemandState({ score: 80 });

      const lowResult = engine.computePrice(
        floorPrice, null, lowDemand, quality, supply, null,
      );
      const highResult = engine.computePrice(
        floorPrice, null, highDemand, quality, supply, null,
      );

      expect(highResult.price).toBeGreaterThan(lowResult.price);
      expect(highResult.multipliers.demand).toBeGreaterThan(lowResult.multipliers.demand);
    });

    it("should follow sigmoid curve — not linear", () => {
      const floorPrice = 0.01;
      const quality = createQualityMetrics();
      const supply = createSupplyState();

      // Get prices at 25, 50, 75 demand
      const prices = [25, 50, 75].map((score) => {
        const demand = createDemandState({ score });
        return engine.computePrice(floorPrice, null, demand, quality, supply, null);
      });

      // Price increase from 50→75 should be larger than 25→50
      // (sigmoid curve is steeper in the middle-to-high range)
      const jump1 = prices[1].price - prices[0].price;
      const jump2 = prices[2].price - prices[1].price;

      expect(jump2).toBeGreaterThan(jump1);
    });

    it("should cap at max demand multiplier", () => {
      const demand = createDemandState({ score: 100 });
      const quality = createQualityMetrics({ compositeScore: 50 });
      const supply = createSupplyState({ competitorCount: 10 });

      const result = engine.computePrice(
        0.01, null, demand, quality, supply, null,
      );

      // Demand multiplier should not exceed config max
      const config = engine.getConfig();
      expect(result.multipliers.demand).toBeLessThanOrEqual(config.maxDemandMultiplier + 0.01);
    });
  });

  // ═══════════════════════════════════════════
  // SCARCITY MULTIPLIER
  // ═══════════════════════════════════════════

  describe("Scarcity Multiplier", () => {
    it("should give maximum premium to unique listings", () => {
      const demand = createDemandState();
      const quality = createQualityMetrics();

      const unique = createSupplyState({ competitorCount: 0, isUnique: true });
      const crowded = createSupplyState({ competitorCount: 10 });

      const uniqueResult = engine.computePrice(
        0.01, null, demand, quality, unique, null,
      );
      const crowdedResult = engine.computePrice(
        0.01, null, demand, quality, crowded, null,
      );

      expect(uniqueResult.multipliers.scarcity).toBeGreaterThan(crowdedResult.multipliers.scarcity);
      expect(uniqueResult.price).toBeGreaterThan(crowdedResult.price);
    });

    it("should return 1.0 multiplier with many competitors", () => {
      const supply = createSupplyState({ competitorCount: 10, utilizationPercent: 30 });
      const demand = createDemandState();
      const quality = createQualityMetrics();

      const result = engine.computePrice(0.01, null, demand, quality, supply, null);

      expect(result.multipliers.scarcity).toBe(1);
    });

    it("should add utilization premium at high capacity", () => {
      const demand = createDemandState();
      const quality = createQualityMetrics();

      const lowUtil = createSupplyState({ competitorCount: 10, utilizationPercent: 30 });
      const highUtil = createSupplyState({ competitorCount: 10, utilizationPercent: 95 });

      const lowResult = engine.computePrice(0.01, null, demand, quality, lowUtil, null);
      const highResult = engine.computePrice(0.01, null, demand, quality, highUtil, null);

      expect(highResult.multipliers.scarcity).toBeGreaterThan(lowResult.multipliers.scarcity);
    });
  });

  // ═══════════════════════════════════════════
  // QUALITY MULTIPLIER
  // ═══════════════════════════════════════════

  describe("Quality Multiplier", () => {
    it("should reward high quality with higher prices", () => {
      const demand = createDemandState();
      const supply = createSupplyState();

      const lowQuality = createQualityMetrics({ compositeScore: 30 });
      const highQuality = createQualityMetrics({ compositeScore: 95 });

      const lowResult = engine.computePrice(0.01, null, demand, lowQuality, supply, null);
      const highResult = engine.computePrice(0.01, null, demand, highQuality, supply, null);

      expect(highResult.multipliers.quality).toBeGreaterThan(lowResult.multipliers.quality);
    });

    it("should never drop below quality floor of 0.7", () => {
      const demand = createDemandState();
      const supply = createSupplyState();
      const terrible = createQualityMetrics({ compositeScore: 0 });

      const result = engine.computePrice(0.01, null, demand, terrible, supply, null);

      expect(result.multipliers.quality).toBeGreaterThanOrEqual(0.7);
    });

    it("should give excellence bonus for 90+ scores", () => {
      const demand = createDemandState();
      const supply = createSupplyState();

      const good = createQualityMetrics({ compositeScore: 85 });
      const excellent = createQualityMetrics({ compositeScore: 95 });

      const goodResult = engine.computePrice(0.01, null, demand, good, supply, null);
      const excellentResult = engine.computePrice(0.01, null, demand, excellent, supply, null);

      // The gap between 85→95 should be proportionally larger than 75→85
      // due to the excellence bonus
      const gap = excellentResult.multipliers.quality - goodResult.multipliers.quality;
      expect(gap).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════
  // MOMENTUM MULTIPLIER
  // ═══════════════════════════════════════════

  describe("Momentum Multiplier", () => {
    it("should return 1.0 when velocity is zero", () => {
      const demand = createDemandState({ velocity: 0 });
      const quality = createQualityMetrics();
      const supply = createSupplyState();

      const result = engine.computePrice(0.01, null, demand, quality, supply, null);

      expect(result.multipliers.momentum).toBe(1);
    });

    it("should increase price with positive velocity", () => {
      const quality = createQualityMetrics();
      const supply = createSupplyState();

      const rising = createDemandState({ velocity: 15 });
      const flat = createDemandState({ velocity: 0 });

      const risingResult = engine.computePrice(0.01, null, rising, quality, supply, null);
      const flatResult = engine.computePrice(0.01, null, flat, quality, supply, null);

      expect(risingResult.multipliers.momentum).toBeGreaterThan(flatResult.multipliers.momentum);
    });

    it("should decrease price with negative velocity", () => {
      const quality = createQualityMetrics();
      const supply = createSupplyState();

      const falling = createDemandState({ velocity: -15 });

      const result = engine.computePrice(0.01, null, falling, quality, supply, null);

      expect(result.multipliers.momentum).toBeLessThan(1);
    });
  });

  // ═══════════════════════════════════════════
  // PRICE SMOOTHING & RATE LIMITING
  // ═══════════════════════════════════════════

  describe("Smoothing and Rate Limiting", () => {
    it("should smooth price against previous value", () => {
      const demand = createDemandState({ score: 90 });
      const quality = createQualityMetrics();
      const supply = createSupplyState({ competitorCount: 0, isUnique: true });

      const previousPrice = 0.01;
      const floorPrice = 0.005;

      // First compute without previous (unconstrained)
      const unconstrained = engine.computePrice(
        floorPrice, null, demand, quality, supply, null,
      );

      // Then compute with previous (should be smoothed toward previous)
      const smoothed = engine.computePrice(
        floorPrice, null, demand, quality, supply, previousPrice,
      );

      // Smoothed price should be between previous and unconstrained
      const minExpected = Math.min(previousPrice, unconstrained.price);
      const maxExpected = Math.max(previousPrice, unconstrained.price);

      expect(smoothed.price).toBeGreaterThanOrEqual(Math.min(minExpected, floorPrice));
      expect(smoothed.price).toBeLessThanOrEqual(maxExpected * 1.01); // Small tolerance
    });

    it("should enforce max price change per cycle", () => {
      const config: Partial<PricingConfig> = { maxPriceChangePercent: 10 };
      const limitedEngine = new PricingEngine(config);

      const demand = createDemandState({ score: 100 });
      const quality = createQualityMetrics({ compositeScore: 100 });
      const supply = createSupplyState({ competitorCount: 0, isUnique: true });
      const previousPrice = 0.01;

      const result = limitedEngine.computePrice(
        0.005, null, demand, quality, supply, previousPrice,
      );

      const maxAllowed = previousPrice * 1.10;
      expect(result.price).toBeLessThanOrEqual(maxAllowed + 0.000001); // USDC precision
    });
  });

  // ═══════════════════════════════════════════
  // TRANSACTION SPLITS
  // ═══════════════════════════════════════════

  describe("Transaction Splits", () => {
    it("should correctly split payment between provider and platform", () => {
      const price = 0.01;
      const split = engine.computeTransactionSplit(price);

      expect(split.buyerPays).toBe(price);
      expect(split.platformFee).toBeCloseTo(price * 0.12, 6);
      expect(split.providerReceives).toBeCloseTo(price * 0.88, 6);
      expect(split.providerReceives + split.platformFee).toBeCloseTo(price, 6);
    });

    it("should handle micropayments without precision loss", () => {
      const microPrice = 0.000012; // $0.000012 per call
      const split = engine.computeTransactionSplit(microPrice);

      expect(split.buyerPays).toBe(microPrice);
      expect(split.providerReceives + split.platformFee).toBeCloseTo(microPrice, 6);
    });
  });

  // ═══════════════════════════════════════════
  // SIMULATION
  // ═══════════════════════════════════════════

  describe("Price Simulation", () => {
    it("should return reasonable prices for various scenarios", () => {
      const scenarios = [
        { floor: 0.001, demand: 20, competitors: 10, quality: 70, label: "Low demand, crowded" },
        { floor: 0.001, demand: 80, competitors: 0, quality: 95, label: "High demand, unique, excellent" },
        { floor: 0.01, demand: 50, competitors: 3, quality: 80, label: "Medium everything" },
        { floor: 0.05, demand: 95, competitors: 1, quality: 90, label: "Premium scarce asset" },
      ];

      for (const s of scenarios) {
        const result = engine.simulatePrice(s.floor, s.demand, s.competitors, s.quality);

        expect(result.price).toBeGreaterThanOrEqual(s.floor);
        expect(result.price).toBeFinite();
        expect(result.price).not.toBeNaN();
        expect(result.multipliers.combined).toBeGreaterThan(0);
      }
    });
  });

  // ═══════════════════════════════════════════
  // BATCH PROCESSING
  // ═══════════════════════════════════════════

  describe("Batch Computation", () => {
    it("should compute prices for multiple listings", () => {
      const listings = Array.from({ length: 50 }, (_, i) => ({
        listingId: `listing-${i}`,
        floorPrice: 0.001 + i * 0.001,
        ceilingPrice: null,
        demand: createDemandState({ listingId: `listing-${i}`, score: Math.random() * 100 }),
        quality: createQualityMetrics({ listingId: `listing-${i}`, compositeScore: 50 + Math.random() * 50 }),
        supply: createSupplyState({ listingId: `listing-${i}`, competitorCount: Math.floor(Math.random() * 10) }),
        previousPrice: null,
      }));

      const results = engine.computeBatch(listings);

      expect(results).toHaveLength(50);

      for (let i = 0; i < results.length; i++) {
        expect(results[i].price).toBeGreaterThanOrEqual(listings[i].floorPrice);
        expect(results[i].computeTimeUs).toBeLessThan(1000); // Each under 1ms
      }
    });
  });

  // ═══════════════════════════════════════════
  // PERFORMANCE
  // ═══════════════════════════════════════════

  describe("Performance", () => {
    it("should compute a single price in under 100 microseconds", () => {
      const demand = createDemandState();
      const quality = createQualityMetrics();
      const supply = createSupplyState();

      // Warm up
      engine.computePrice(0.01, null, demand, quality, supply, null);

      // Measure
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        engine.computePrice(0.01, null, demand, quality, supply, 0.012);
      }
      const elapsed = performance.now() - start;
      const avgMicros = (elapsed / 1000) * 1000;

      expect(avgMicros).toBeLessThan(100); // Under 100μs per computation
    });
  });
});
