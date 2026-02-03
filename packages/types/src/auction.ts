// ═══════════════════════════════════════════════════════════════
// NexusX — Core Auction Types
// packages/types/src/auction.ts
// ═══════════════════════════════════════════════════════════════

/**
 * Represents a single demand signal captured from the system.
 * Signals are aggregated over time windows to compute demand scores.
 */
export interface DemandSignal {
  listingId: string;
  timestamp: number;
  type: DemandSignalType;
  weight: number;
  metadata?: Record<string, unknown>;
}

export enum DemandSignalType {
  /** Actual API call executed and billed */
  API_CALL = "API_CALL",
  /** Listing page viewed by a buyer */
  VIEW = "VIEW",
  /** Buyer added listing to watchlist */
  WATCHLIST_ADD = "WATCHLIST_ADD",
  /** Buyer ran a sandbox test call */
  SANDBOX_TEST = "SANDBOX_TEST",
  /** Buyer subscribed to the listing */
  SUBSCRIPTION = "SUBSCRIPTION",
  /** Buyer unsubscribed from the listing */
  UNSUBSCRIPTION = "UNSUBSCRIPTION",
  /** Failed call due to rate limiting (indicates excess demand) */
  RATE_LIMITED = "RATE_LIMITED",
}

/**
 * Signal weights define how much each signal type contributes
 * to the overall demand score. Higher weight = stronger demand indicator.
 */
export const DEFAULT_SIGNAL_WEIGHTS: Record<DemandSignalType, number> = {
  [DemandSignalType.API_CALL]: 1.0,
  [DemandSignalType.VIEW]: 0.1,
  [DemandSignalType.WATCHLIST_ADD]: 0.3,
  [DemandSignalType.SANDBOX_TEST]: 0.5,
  [DemandSignalType.SUBSCRIPTION]: 2.0,
  [DemandSignalType.UNSUBSCRIPTION]: -1.5,
  [DemandSignalType.RATE_LIMITED]: 1.5,
};

/**
 * Aggregated demand state for a listing over a time window.
 */
export interface DemandState {
  listingId: string;
  /** Normalized demand score 0-100 */
  score: number;
  /** Raw weighted signal count in current window */
  rawSignalSum: number;
  /** Number of unique buyers generating signals */
  uniqueBuyers: number;
  /** Demand velocity: rate of change in score over last N windows */
  velocity: number;
  /** Timestamp of last computation */
  computedAt: number;
  /** Time window in milliseconds that this state covers */
  windowMs: number;
}

/**
 * Quality metrics for a provider's listing.
 * Updated periodically based on real performance data.
 */
export interface QualityMetrics {
  listingId: string;
  /** Uptime percentage over trailing 30 days (0-100) */
  uptimePercent: number;
  /** Median response latency in milliseconds */
  medianLatencyMs: number;
  /** P99 response latency in milliseconds */
  p99LatencyMs: number;
  /** Error rate as percentage (0-100) */
  errorRatePercent: number;
  /** Average buyer rating (1-5) */
  averageRating: number;
  /** Total number of ratings */
  ratingCount: number;
  /** Composite quality score (0-100), computed from above */
  compositeScore: number;
  /** Timestamp of last computation */
  computedAt: number;
}

/**
 * Supply-side state for scarcity calculations.
 */
export interface SupplyState {
  listingId: string;
  /** Category this listing belongs to */
  categoryId: string;
  /** Number of competing listings in the same category */
  competitorCount: number;
  /** Whether this listing has unique capabilities not found elsewhere */
  isUnique: boolean;
  /** Provider's stated capacity (max calls/minute) */
  capacityPerMinute: number;
  /** Current utilization as percentage of capacity (0-100) */
  utilizationPercent: number;
  /** Timestamp of last computation */
  computedAt: number;
}

/**
 * The complete price state for a listing at a point in time.
 */
export interface PriceState {
  listingId: string;
  /** Provider-set minimum price per call in USDC */
  floorPrice: number;
  /** Provider-set maximum price per call in USDC (optional ceiling) */
  ceilingPrice: number | null;
  /** Current auction-determined price per call in USDC */
  currentPrice: number;
  /** Previous price before last update */
  previousPrice: number;
  /** Percentage change from previous price */
  priceChangePercent: number;
  /** Individual multiplier contributions for transparency */
  multipliers: PriceMultipliers;
  /** Timestamp of last price computation */
  computedAt: number;
  /** Number of consecutive windows price has been at floor */
  windowsAtFloor: number;
  /** Number of consecutive windows price has been at ceiling */
  windowsAtCeiling: number;
}

/**
 * Breakdown of individual multipliers applied to the floor price.
 * This transparency is critical for provider trust — they need to
 * understand WHY the price is what it is.
 */
export interface PriceMultipliers {
  /** Multiplier from demand score (1.0 = no effect) */
  demand: number;
  /** Multiplier from supply scarcity (1.0 = no effect) */
  scarcity: number;
  /** Multiplier from quality score (1.0 = no effect) */
  quality: number;
  /** Multiplier from demand velocity / momentum (1.0 = no effect) */
  momentum: number;
  /** Time-of-day adjustment (1.0 = no effect) */
  temporal: number;
  /** Combined final multiplier (product of all above) */
  combined: number;
}

/**
 * Result of a single price computation by the engine.
 */
export interface AuctionResult {
  listingId: string;
  /** The computed price in USDC */
  price: number;
  /** Floor price for reference */
  floorPrice: number;
  /** Multiplier breakdown */
  multipliers: PriceMultipliers;
  /** Input states used for computation */
  inputs: {
    demand: DemandState;
    quality: QualityMetrics;
    supply: SupplyState;
  };
  /** Timestamp of computation */
  computedAt: number;
  /** Computation latency in microseconds */
  computeTimeUs: number;
}

/**
 * Configuration for the pricing engine.
 * These are the tunable knobs that control pricing behavior.
 */
export interface PricingConfig {
  /** How often to recompute prices (milliseconds) */
  updateIntervalMs: number;
  /** Time window for demand signal aggregation (milliseconds) */
  demandWindowMs: number;
  /** Maximum multiplier the demand component can apply */
  maxDemandMultiplier: number;
  /** Maximum multiplier the scarcity component can apply */
  maxScarcityMultiplier: number;
  /** Maximum multiplier the quality component can apply */
  maxQualityMultiplier: number;
  /** Maximum multiplier momentum can apply */
  maxMomentumMultiplier: number;
  /** Smoothing factor for price changes (0-1, higher = more responsive) */
  smoothingFactor: number;
  /** Maximum allowed price change per update cycle as percentage */
  maxPriceChangePercent: number;
  /** Platform fee as a decimal (0.12 = 12%) */
  platformFeeRate: number;
}

/**
 * Default production configuration.
 * Conservative settings — prices move but don't spike wildly.
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  updateIntervalMs: 10_000,        // Recompute every 10 seconds
  demandWindowMs: 300_000,          // 5-minute demand windows
  maxDemandMultiplier: 3.5,         // Demand can 3.5x the floor
  maxScarcityMultiplier: 2.0,       // Scarcity can 2x the floor
  maxQualityMultiplier: 1.5,        // Quality can 1.5x the floor
  maxMomentumMultiplier: 1.3,       // Momentum can 1.3x the floor
  smoothingFactor: 0.3,             // 30% weight to new price, 70% to old
  maxPriceChangePercent: 15,        // Max 15% move per update cycle
  platformFeeRate: 0.12,            // 12% take rate
};
