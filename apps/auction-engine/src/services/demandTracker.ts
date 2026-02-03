// ═══════════════════════════════════════════════════════════════
// NexusX — Demand Tracker
// apps/auction-engine/src/services/demandTracker.ts
//
// Aggregates real-time demand signals (API calls, views, watchlist
// adds, etc.) into normalized demand scores per listing.
//
// Architecture:
//   - Signals flow in from the gateway via Redis pub/sub
//   - Stored in sliding time windows (ring buffer)
//   - Each window produces a DemandState with score + velocity
//   - DemandState feeds directly into the pricing engine
//
// The demand score is the single most influential input to price.
// It needs to be responsive enough to capture real demand shifts
// but resistant to gaming and flash spikes.
// ═══════════════════════════════════════════════════════════════

import type {
  DemandSignal,
  DemandSignalType,
  DemandState,
  PricingConfig,
} from "../../../../packages/types/src/auction";

import {
  DEFAULT_SIGNAL_WEIGHTS,
  DEFAULT_PRICING_CONFIG,
} from "../../../../packages/types/src/auction";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SignalWindow {
  /** Weighted sum of signals in this window */
  weightedSum: number;
  /** Set of unique buyer IDs that generated signals */
  uniqueBuyers: Set<string>;
  /** Timestamp when this window opened */
  openedAt: number;
  /** Timestamp when this window closed (0 if still active) */
  closedAt: number;
  /** Raw signal count (unweighted) */
  rawCount: number;
}

interface ListingTracker {
  listingId: string;
  /** Current active window */
  currentWindow: SignalWindow;
  /** Historical windows for velocity calculation (last N) */
  historicalWindows: SignalWindow[];
  /** Last computed demand state */
  lastState: DemandState | null;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Number of historical windows to retain for velocity calculation */
const HISTORY_DEPTH = 12;

/**
 * Percentile thresholds for demand normalization.
 * A score of 50 means "average demand for this category."
 * These are bootstrapped initially and updated from real data.
 */
const DEFAULT_PERCENTILES = {
  p10: 5,      // Bottom 10% of listings see ~5 weighted signals/window
  p50: 50,     // Median listing sees ~50 weighted signals/window
  p90: 200,    // Top 10% see ~200 weighted signals/window
  p99: 1000,   // Top 1% see ~1000 weighted signals/window
};

// ─────────────────────────────────────────────
// Demand Tracker
// ─────────────────────────────────────────────

export class DemandTracker {
  private trackers: Map<string, ListingTracker> = new Map();
  private config: PricingConfig;
  private signalWeights: Record<DemandSignalType, number>;
  private percentiles: typeof DEFAULT_PERCENTILES;

  constructor(
    config: Partial<PricingConfig> = {},
    signalWeights?: Partial<Record<DemandSignalType, number>>,
  ) {
    this.config = { ...DEFAULT_PRICING_CONFIG, ...config };
    this.signalWeights = { ...DEFAULT_SIGNAL_WEIGHTS, ...signalWeights };
    this.percentiles = { ...DEFAULT_PERCENTILES };
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════

  /**
   * Ingest a single demand signal.
   * Called by the gateway for every relevant event.
   * Must be fast (<100μs) as it's in the hot path.
   */
  ingestSignal(signal: DemandSignal, buyerId?: string): void {
    const tracker = this.getOrCreateTracker(signal.listingId);

    // Rotate window if current one has expired
    this.maybeRotateWindow(tracker);

    // Compute weighted value for this signal
    const weight = this.signalWeights[signal.type] ?? 0;
    const weightedValue = weight * (signal.weight || 1);

    // Add to current window
    tracker.currentWindow.weightedSum += weightedValue;
    tracker.currentWindow.rawCount += 1;

    if (buyerId) {
      tracker.currentWindow.uniqueBuyers.add(buyerId);
    }
  }

  /**
   * Ingest a batch of signals (for bulk replay or catch-up).
   */
  ingestBatch(signals: Array<{ signal: DemandSignal; buyerId?: string }>): void {
    for (const { signal, buyerId } of signals) {
      this.ingestSignal(signal, buyerId);
    }
  }

  /**
   * Compute the current demand state for a listing.
   * Called by the pricing engine on each update cycle.
   */
  computeDemandState(listingId: string): DemandState {
    const tracker = this.getOrCreateTracker(listingId);

    // Rotate window if needed
    this.maybeRotateWindow(tracker);

    // Normalize the raw weighted sum to a 0-100 score
    const score = this.normalizeScore(tracker.currentWindow.weightedSum);

    // Compute velocity from historical windows
    const velocity = this.computeVelocity(tracker);

    const state: DemandState = {
      listingId,
      score,
      rawSignalSum: tracker.currentWindow.weightedSum,
      uniqueBuyers: tracker.currentWindow.uniqueBuyers.size,
      velocity,
      computedAt: Date.now(),
      windowMs: this.config.demandWindowMs,
    };

    tracker.lastState = state;
    return state;
  }

  /**
   * Get demand states for all tracked listings.
   * Used by the batch price updater worker.
   */
  computeAllDemandStates(): DemandState[] {
    const states: DemandState[] = [];
    for (const [listingId] of this.trackers) {
      states.push(this.computeDemandState(listingId));
    }
    return states;
  }

  /**
   * Get the last computed state without recomputing.
   * Used for quick reads (dashboard, WebSocket feed).
   */
  getLastState(listingId: string): DemandState | null {
    return this.trackers.get(listingId)?.lastState ?? null;
  }

  /**
   * Update percentile thresholds from real data.
   * Should be called periodically (e.g., hourly) by the
   * demand aggregator worker after analyzing all listings.
   */
  updatePercentiles(percentiles: Partial<typeof DEFAULT_PERCENTILES>): void {
    this.percentiles = { ...this.percentiles, ...percentiles };
  }

  /**
   * Remove a listing's tracker (when listing is delisted).
   */
  removeListing(listingId: string): void {
    this.trackers.delete(listingId);
  }

  /**
   * Get stats about the tracker for monitoring.
   */
  getStats(): {
    trackedListings: number;
    totalSignalsInCurrentWindows: number;
    totalUniqueBuyers: number;
  } {
    let totalSignals = 0;
    const allBuyers = new Set<string>();

    for (const [, tracker] of this.trackers) {
      totalSignals += tracker.currentWindow.rawCount;
      for (const buyer of tracker.currentWindow.uniqueBuyers) {
        allBuyers.add(buyer);
      }
    }

    return {
      trackedListings: this.trackers.size,
      totalSignalsInCurrentWindows: totalSignals,
      totalUniqueBuyers: allBuyers.size,
    };
  }

  // ═══════════════════════════════════════════
  // INTERNAL METHODS
  // ═══════════════════════════════════════════

  private getOrCreateTracker(listingId: string): ListingTracker {
    let tracker = this.trackers.get(listingId);
    if (!tracker) {
      tracker = {
        listingId,
        currentWindow: this.createWindow(),
        historicalWindows: [],
        lastState: null,
      };
      this.trackers.set(listingId, tracker);
    }
    return tracker;
  }

  private createWindow(): SignalWindow {
    return {
      weightedSum: 0,
      uniqueBuyers: new Set(),
      openedAt: Date.now(),
      closedAt: 0,
      rawCount: 0,
    };
  }

  /**
   * Check if the current window has expired and rotate if so.
   * Closed windows go into the history ring buffer.
   */
  private maybeRotateWindow(tracker: ListingTracker): void {
    const elapsed = Date.now() - tracker.currentWindow.openedAt;
    if (elapsed < this.config.demandWindowMs) return;

    // Close current window
    tracker.currentWindow.closedAt = Date.now();

    // Push to history
    tracker.historicalWindows.push(tracker.currentWindow);

    // Trim history to HISTORY_DEPTH
    if (tracker.historicalWindows.length > HISTORY_DEPTH) {
      tracker.historicalWindows = tracker.historicalWindows.slice(-HISTORY_DEPTH);
    }

    // Open new window
    tracker.currentWindow = this.createWindow();
  }

  /**
   * Normalize a raw weighted signal sum to a 0-100 score.
   *
   * Uses piecewise linear interpolation against percentile thresholds.
   * This means a score of 50 always represents "median demand"
   * regardless of absolute signal volumes.
   *
   * As the marketplace grows and signal volumes increase, the
   * percentile thresholds are updated by the aggregator worker
   * so that scores remain meaningful.
   */
  private normalizeScore(rawSum: number): number {
    const p = this.percentiles;

    if (rawSum <= 0) return 0;
    if (rawSum <= p.p10) return (rawSum / p.p10) * 10;
    if (rawSum <= p.p50) return 10 + ((rawSum - p.p10) / (p.p50 - p.p10)) * 40;
    if (rawSum <= p.p90) return 50 + ((rawSum - p.p50) / (p.p90 - p.p50)) * 40;
    if (rawSum <= p.p99) return 90 + ((rawSum - p.p90) / (p.p99 - p.p90)) * 10;
    return 100;
  }

  /**
   * Compute demand velocity from historical windows.
   *
   * Velocity = rate of change in demand score over recent windows.
   * Positive velocity → demand is rising → momentum multiplier increases.
   * Negative velocity → demand is falling → momentum multiplier decreases.
   *
   * Uses linear regression over the last N windows for stability.
   * Falls back to simple difference if insufficient history.
   */
  private computeVelocity(tracker: ListingTracker): number {
    const windows = tracker.historicalWindows;
    if (windows.length < 2) return 0;

    // Use the last min(6, available) windows
    const recentWindows = windows.slice(-6);
    const scores = recentWindows.map((w) => this.normalizeScore(w.weightedSum));

    if (scores.length < 2) return 0;

    // Simple linear regression: velocity = slope of score over time
    const n = scores.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += scores[i];
      sumXY += i * scores[i];
      sumX2 += i * i;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;

    const slope = (n * sumXY - sumX * sumY) / denominator;

    // Slope represents score change per window.
    // Multiply by a scaling factor to make velocity intuitive.
    // A velocity of 10 means "demand score is rising 10 points per window."
    return Math.round(slope * 100) / 100;
  }
}

// ─────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────

let instance: DemandTracker | null = null;

export const getDemandTracker = (
  config?: Partial<PricingConfig>,
): DemandTracker => {
  if (!instance) {
    instance = new DemandTracker(config);
  }
  return instance;
};

export const resetDemandTracker = (): void => {
  instance = null;
};
