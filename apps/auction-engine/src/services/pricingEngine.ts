// ═══════════════════════════════════════════════════════════════
// NexusX — Dynamic Auction Pricing Engine
// apps/auction-engine/src/services/pricingEngine.ts
//
// This is the core IP of the platform. Every dollar that flows
// through NexusX is determined by this algorithm.
//
// Architecture:
//   floor_price × demand × scarcity × quality × momentum × temporal
//   → smoothed against previous price
//   → clamped within floor/ceiling bounds
//   → rate-limited to prevent wild swings
//
// Design Principles:
//   1. Providers must ALWAYS earn >= floor price (trust)
//   2. Price changes are smoothed to prevent buyer shock
//   3. Every multiplier is transparent and explainable
//   4. The engine is stateless per computation — all state is injected
//   5. Computation must be <1ms (we're in the hot path)
// ═══════════════════════════════════════════════════════════════

import type {
  DemandState,
  QualityMetrics,
  SupplyState,
  PriceState,
  PriceMultipliers,
  AuctionResult,
  PricingConfig,
} from "../../../packages/types/src/auction";

import { DEFAULT_PRICING_CONFIG } from "../../../packages/types/src/auction";

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

/** Clamp a value between min and max */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Linear interpolation */
const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** Get current time in microseconds for performance tracking */
const microtime = (): number =>
  typeof performance !== "undefined"
    ? performance.now() * 1000
    : Date.now() * 1000;

// ─────────────────────────────────────────────
// Pricing Engine
// ─────────────────────────────────────────────

export class PricingEngine {
  private config: PricingConfig;

  constructor(config: Partial<PricingConfig> = {}) {
    this.config = { ...DEFAULT_PRICING_CONFIG, ...config };
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════

  /**
   * Compute the auction price for a single listing.
   * This is the hot path — called on every price update cycle.
   *
   * @param floorPrice   - Provider's minimum acceptable price (USDC)
   * @param ceilingPrice - Provider's optional maximum price (USDC), null = uncapped
   * @param demand       - Current demand state for this listing
   * @param quality      - Current quality metrics for this listing
   * @param supply       - Current supply/scarcity state for this listing
   * @param previousPrice - The last computed price (for smoothing)
   * @returns AuctionResult with the new price and full multiplier breakdown
   */
  computePrice(
    floorPrice: number,
    ceilingPrice: number | null,
    demand: DemandState,
    quality: QualityMetrics,
    supply: SupplyState,
    previousPrice: number | null,
  ): AuctionResult {
    const startTime = microtime();

    // ── Step 1: Compute individual multipliers ──
    const demandMultiplier = this.computeDemandMultiplier(demand);
    const scarcityMultiplier = this.computeScarcityMultiplier(supply);
    const qualityMultiplier = this.computeQualityMultiplier(quality);
    const momentumMultiplier = this.computeMomentumMultiplier(demand);
    const temporalMultiplier = this.computeTemporalMultiplier();

    // ── Step 2: Combine multipliers ──
    // Multiplicative combination — each factor compounds
    const combinedMultiplier =
      demandMultiplier *
      scarcityMultiplier *
      qualityMultiplier *
      momentumMultiplier *
      temporalMultiplier;

    // ── Step 3: Apply to floor price ──
    let rawPrice = floorPrice * combinedMultiplier;

    // ── Step 4: Smooth against previous price ──
    // This prevents jarring price jumps between update cycles.
    // smoothingFactor of 0.3 means: 30% new price + 70% old price
    if (previousPrice !== null && previousPrice > 0) {
      rawPrice = lerp(previousPrice, rawPrice, this.config.smoothingFactor);
    }

    // ── Step 5: Apply rate limiting ──
    // Even after smoothing, cap the maximum change per cycle
    if (previousPrice !== null && previousPrice > 0) {
      const maxDelta = previousPrice * (this.config.maxPriceChangePercent / 100);
      const delta = rawPrice - previousPrice;
      if (Math.abs(delta) > maxDelta) {
        rawPrice = previousPrice + Math.sign(delta) * maxDelta;
      }
    }

    // ── Step 6: Enforce floor and ceiling bounds ──
    // Provider's floor is sacred — we NEVER go below it
    rawPrice = Math.max(rawPrice, floorPrice);

    // If provider set a ceiling, respect it
    if (ceilingPrice !== null) {
      rawPrice = Math.min(rawPrice, ceilingPrice);
    }

    // ── Step 7: Round to 6 decimal places (USDC precision) ──
    const finalPrice = Math.round(rawPrice * 1_000_000) / 1_000_000;

    // ── Step 8: Build result ──
    const multipliers: PriceMultipliers = {
      demand: demandMultiplier,
      scarcity: scarcityMultiplier,
      quality: qualityMultiplier,
      momentum: momentumMultiplier,
      temporal: temporalMultiplier,
      combined: combinedMultiplier,
    };

    const computeTimeUs = microtime() - startTime;

    return {
      listingId: demand.listingId,
      price: finalPrice,
      floorPrice,
      multipliers,
      inputs: { demand, quality, supply },
      computedAt: Date.now(),
      computeTimeUs,
    };
  }

  /**
   * Batch compute prices for multiple listings.
   * Used by the price updater worker on each cycle.
   */
  computeBatch(
    listings: Array<{
      listingId: string;
      floorPrice: number;
      ceilingPrice: number | null;
      demand: DemandState;
      quality: QualityMetrics;
      supply: SupplyState;
      previousPrice: number | null;
    }>,
  ): AuctionResult[] {
    return listings.map((listing) =>
      this.computePrice(
        listing.floorPrice,
        listing.ceilingPrice,
        listing.demand,
        listing.quality,
        listing.supply,
        listing.previousPrice,
      ),
    );
  }

  /**
   * Compute what the buyer actually pays and how it splits.
   * This is called at transaction time, not during price updates.
   */
  computeTransactionSplit(auctionPrice: number): {
    buyerPays: number;
    providerReceives: number;
    platformFee: number;
    feeRate: number;
  } {
    const platformFee = auctionPrice * this.config.platformFeeRate;
    const providerReceives = auctionPrice - platformFee;

    return {
      buyerPays: auctionPrice,
      providerReceives: Math.round(providerReceives * 1_000_000) / 1_000_000,
      platformFee: Math.round(platformFee * 1_000_000) / 1_000_000,
      feeRate: this.config.platformFeeRate,
    };
  }

  /**
   * Simulate how a listing's price would change given hypothetical inputs.
   * Used by the provider dashboard to show "what if" scenarios.
   */
  simulatePrice(
    floorPrice: number,
    demandScore: number,
    competitorCount: number,
    qualityScore: number,
  ): { price: number; multipliers: PriceMultipliers } {
    const mockDemand: DemandState = {
      listingId: "simulation",
      score: clamp(demandScore, 0, 100),
      rawSignalSum: 0,
      uniqueBuyers: 0,
      velocity: 0,
      computedAt: Date.now(),
      windowMs: this.config.demandWindowMs,
    };

    const mockQuality: QualityMetrics = {
      listingId: "simulation",
      uptimePercent: 99.9,
      medianLatencyMs: 50,
      p99LatencyMs: 200,
      errorRatePercent: 0.1,
      averageRating: 4.5,
      ratingCount: 100,
      compositeScore: clamp(qualityScore, 0, 100),
      computedAt: Date.now(),
    };

    const mockSupply: SupplyState = {
      listingId: "simulation",
      categoryId: "simulation",
      competitorCount: Math.max(0, competitorCount),
      isUnique: competitorCount === 0,
      capacityPerMinute: 1000,
      utilizationPercent: 50,
      computedAt: Date.now(),
    };

    const result = this.computePrice(
      floorPrice,
      null,
      mockDemand,
      mockQuality,
      mockSupply,
      null,
    );

    return { price: result.price, multipliers: result.multipliers };
  }

  // ═══════════════════════════════════════════
  // MULTIPLIER COMPUTATIONS (private)
  // ═══════════════════════════════════════════

  /**
   * DEMAND MULTIPLIER
   *
   * Maps a 0-100 demand score to a price multiplier.
   * Uses a sigmoid-like curve so that:
   *   - Low demand (0-20):   multiplier stays near 1.0 (no premium)
   *   - Mid demand (20-60):  gradual increase
   *   - High demand (60-90): accelerating increase
   *   - Peak demand (90-100): approaches max multiplier asymptotically
   *
   * This curve shape is intentional — it rewards providers for building
   * popular products (high demand lifts their price) while protecting
   * buyers from extreme spikes (asymptotic ceiling).
   *
   * The formula: 1 + (maxMultiplier - 1) × sigmoid(score)
   * where sigmoid(score) = 1 / (1 + e^(-k(score - midpoint)))
   */
  private computeDemandMultiplier(demand: DemandState): number {
    const score = clamp(demand.score, 0, 100);
    const maxM = this.config.maxDemandMultiplier;

    // Sigmoid parameters
    const midpoint = 50;  // Score where multiplier is halfway to max
    const steepness = 0.08; // Controls how sharp the curve is

    // Sigmoid function normalized to [0, 1]
    const sigmoid = 1 / (1 + Math.exp(-steepness * (score - midpoint)));

    // Map to [1.0, maxMultiplier]
    const multiplier = 1 + (maxM - 1) * sigmoid;

    return Math.round(multiplier * 10000) / 10000;
  }

  /**
   * SCARCITY MULTIPLIER
   *
   * Prices increase when there are fewer competing providers.
   * This incentivizes providers to list in underserved categories.
   *
   * Logic:
   *   - 0 competitors (unique): maximum scarcity multiplier
   *   - 1-2 competitors: moderate premium
   *   - 3-5 competitors: slight premium
   *   - 6+ competitors: no scarcity premium (multiplier = 1.0)
   *
   * Also factors in utilization — a listing running at 90%+ capacity
   * is scarce even if competitors exist, because it might hit limits.
   */
  private computeScarcityMultiplier(supply: SupplyState): number {
    const maxM = this.config.maxScarcityMultiplier;
    const competitors = supply.competitorCount;
    const utilization = clamp(supply.utilizationPercent, 0, 100);

    // Base scarcity from competitor count
    // Inverse relationship: fewer competitors = higher multiplier
    let competitorFactor: number;
    if (supply.isUnique || competitors === 0) {
      competitorFactor = 1.0; // Full scarcity
    } else if (competitors <= 2) {
      competitorFactor = 0.6;
    } else if (competitors <= 5) {
      competitorFactor = 0.25;
    } else {
      competitorFactor = 0; // No scarcity with 6+ competitors
    }

    // Utilization premium — even with competitors, high utilization = scarce
    // Only kicks in above 70% utilization
    const utilizationFactor = utilization > 70
      ? (utilization - 70) / 30 * 0.4 // Max 0.4 additional factor at 100%
      : 0;

    // Combine: take the higher of competitor-based and utilization-based scarcity
    const scarcityFactor = Math.min(1, Math.max(competitorFactor, utilizationFactor));

    // Map to [1.0, maxMultiplier]
    const multiplier = 1 + (maxM - 1) * scarcityFactor;

    return Math.round(multiplier * 10000) / 10000;
  }

  /**
   * QUALITY MULTIPLIER
   *
   * Higher quality listings command higher prices. This is the
   * provider's incentive to maintain excellent uptime, low latency,
   * and high buyer satisfaction.
   *
   * The composite quality score (0-100) maps to [qualityFloor, maxMultiplier].
   * We set a quality FLOOR of 0.7 — even poor quality listings don't get
   * hammered below 70% of their potential, because the market itself
   * will stop buying from them (natural selection).
   *
   * Exceptional quality (90+) gets a bonus bump to reward excellence.
   */
  private computeQualityMultiplier(quality: QualityMetrics): number {
    const score = clamp(quality.compositeScore, 0, 100);
    const maxM = this.config.maxQualityMultiplier;
    const qualityFloor = 0.7; // Minimum quality multiplier

    // Linear mapping from score to [qualityFloor, maxMultiplier]
    let multiplier = qualityFloor + (maxM - qualityFloor) * (score / 100);

    // Excellence bonus: listings with 90+ quality get an additional bump
    // This creates a visible reward for top-tier providers
    if (score >= 90) {
      const excellenceBonus = ((score - 90) / 10) * 0.15; // Up to +0.15 at score=100
      multiplier += excellenceBonus;
    }

    // Penalty for very low ratings if they have enough volume to be meaningful
    if (quality.averageRating < 3.0 && quality.ratingCount >= 20) {
      multiplier *= 0.85; // 15% penalty for poorly-rated listings with sufficient data
    }

    return Math.round(clamp(multiplier, qualityFloor, maxM + 0.15) * 10000) / 10000;
  }

  /**
   * MOMENTUM MULTIPLIER
   *
   * Captures the TREND of demand, not just the current level.
   * Rising demand pushes prices up faster. Falling demand pulls them down.
   *
   * This prevents the engine from being purely reactive — it anticipates
   * where demand is heading based on velocity.
   *
   * Velocity is pre-computed by the demand tracker as the rate of change
   * in demand score over the last N windows. Positive = rising, negative = falling.
   *
   * Mapping:
   *   velocity < -10: multiplier = 0.85 (demand falling fast, drop price)
   *   velocity -10 to 0: multiplier = 0.85 to 1.0 (gradual decline)
   *   velocity 0 to 10: multiplier = 1.0 to 1.15 (gradual increase)
   *   velocity > 10: multiplier = 1.15 to maxMomentum (surge pricing)
   */
  private computeMomentumMultiplier(demand: DemandState): number {
    const velocity = demand.velocity;
    const maxM = this.config.maxMomentumMultiplier;
    const minM = 1 / maxM; // Symmetric floor (e.g., 0.77 if max is 1.3)

    if (velocity === 0) return 1.0;

    if (velocity > 0) {
      // Rising demand: scale from 1.0 toward maxM
      // Uses sqrt to dampen extreme velocities
      const normalized = Math.min(velocity / 20, 1); // Cap at velocity=20
      const multiplier = 1 + (maxM - 1) * Math.sqrt(normalized);
      return Math.round(clamp(multiplier, 1.0, maxM) * 10000) / 10000;
    } else {
      // Falling demand: scale from 1.0 toward minM
      const normalized = Math.min(Math.abs(velocity) / 20, 1);
      const multiplier = 1 - (1 - minM) * Math.sqrt(normalized);
      return Math.round(clamp(multiplier, minM, 1.0) * 10000) / 10000;
    }
  }

  /**
   * TEMPORAL MULTIPLIER
   *
   * Adjusts prices based on time-of-day patterns.
   * AI API usage has predictable daily cycles:
   *   - Peak: 9am-6pm UTC (US/EU business hours overlap)
   *   - Off-peak: 11pm-6am UTC
   *
   * This is a subtle adjustment (±5%) that helps smooth
   * the daily price curve for buyers who can schedule workloads.
   *
   * In production, this should be learned from actual usage patterns
   * per listing. For now, we use a cosine wave approximation.
   */
  private computeTemporalMultiplier(): number {
    const now = new Date();
    const hourUTC = now.getUTCHours() + now.getUTCMinutes() / 60;

    // Cosine wave peaking at 14:00 UTC (US market open + EU afternoon)
    // Range: [0.95, 1.05]
    const peakHour = 14;
    const amplitude = 0.05;
    const phase = ((hourUTC - peakHour) / 24) * 2 * Math.PI;
    const multiplier = 1 + amplitude * Math.cos(phase);

    return Math.round(multiplier * 10000) / 10000;
  }

  // ═══════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════

  /** Get the current config (for debugging / dashboard display) */
  getConfig(): Readonly<PricingConfig> {
    return { ...this.config };
  }

  /** Update config at runtime (e.g., from admin dashboard) */
  updateConfig(updates: Partial<PricingConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ─────────────────────────────────────────────
// Singleton export for service-wide use
// ─────────────────────────────────────────────

let instance: PricingEngine | null = null;

export const getPricingEngine = (config?: Partial<PricingConfig>): PricingEngine => {
  if (!instance) {
    instance = new PricingEngine(config);
  }
  return instance;
};

export const resetPricingEngine = (): void => {
  instance = null;
};
