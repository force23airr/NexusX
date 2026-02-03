// ═══════════════════════════════════════════════════════════════
// NexusX — Ranking Engine
// apps/ai-router/src/services/rankingEngine.ts
//
// Multi-factor ranking of marketplace listings against a
// classified buyer intent. Combines:
//   - Text relevance (TF-IDF from ListingIndex)
//   - Category match (taxonomy alignment)
//   - Price score (inversely proportional within constraints)
//   - Quality score (composite from QualitySnapshot)
//   - Popularity (normalized call volume)
//   - Latency (response speed)
//   - Capability match (feature requirements)
//
// Each factor produces a [0, 1] score. The composite is a
// weighted sum controlled by intent-specific weight profiles.
// ═══════════════════════════════════════════════════════════════

import {
  type ClassifiedIntent,
  type IndexedListing,
  type RankedMatch,
  type ScoreBreakdown,
  type RankingWeights,
  type RouterConfig,
  DEFAULT_RANKING_WEIGHTS,
} from "../types";
import type { ListingIndex } from "./listingIndex";

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class RankingEngine {
  private config: RouterConfig;
  private index: ListingIndex;

  constructor(index: ListingIndex, config: RouterConfig) {
    this.index = index;
    this.config = config;
  }

  /**
   * Rank all indexed listings against a classified intent.
   *
   * @param intent  Classified buyer intent with entities.
   * @returns Sorted array of ranked matches (best first).
   */
  rank(intent: ClassifiedIntent): RankedMatch[] {
    const weights = this.getWeights(intent.category);
    const entities = intent.entities;

    // ─── Pre-compute shared indexes ───
    const textScores = this.index.textSearch(intent.normalizedQuery);
    const categoryScores = this.index.categorySearch(entities.categories);
    const tagScores = this.index.tagSearch(entities.tags);

    // ─── Global normalization values ───
    const allListings = this.index.getAll();
    if (allListings.length === 0) return [];

    const maxCalls = Math.max(...allListings.map((l) => l.totalCalls), 1);
    const maxLatency = Math.max(...allListings.map((l) => l.avgLatencyMs), 1);
    const priceRange = this.computePriceRange(allListings);

    // ─── Score each listing ───
    const results: RankedMatch[] = [];

    for (const listing of allListings) {
      // Apply hard filters first — skip listings that can't match.
      if (!this.passesFilters(listing, entities)) continue;

      const breakdown = this.computeBreakdown(
        listing,
        intent,
        textScores,
        categoryScores,
        tagScores,
        maxCalls,
        maxLatency,
        priceRange
      );

      const compositeScore = this.computeComposite(breakdown, weights);
      const matchReasons = this.generateMatchReasons(breakdown, listing, entities);

      results.push({
        listing,
        score: compositeScore,
        scoreBreakdown: breakdown,
        matchReasons,
      });
    }

    // Sort by composite score descending.
    results.sort((a, b) => b.score - a.score);

    // Apply sort preference override if specified.
    if (entities.sortPreference) {
      this.applySortOverride(results, entities.sortPreference);
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────
  // SCORE COMPUTATION
  // ─────────────────────────────────────────────────────────

  private computeBreakdown(
    listing: IndexedListing,
    intent: ClassifiedIntent,
    textScores: Map<string, number>,
    categoryScores: Map<string, number>,
    tagScores: Map<string, number>,
    maxCalls: number,
    maxLatency: number,
    priceRange: { min: number; max: number }
  ): ScoreBreakdown {
    // 1. Text relevance: TF-IDF + tag bonus.
    const textRelevance = Math.min(1,
      (textScores.get(listing.id) || 0) * 0.7 +
      (tagScores.get(listing.id) || 0) * 0.3
    );

    // 2. Category match: taxonomy alignment.
    const categoryMatch = categoryScores.get(listing.id) || 0;

    // 3. Price score: inversely proportional.
    // If buyer specified maxPrice, penalize above it heavily.
    let priceScore: number;
    if (intent.entities.maxPriceUsdc !== undefined) {
      if (listing.currentPriceUsdc <= intent.entities.maxPriceUsdc) {
        // Within budget — score by how much under.
        priceScore = 1 - (listing.currentPriceUsdc / intent.entities.maxPriceUsdc) * 0.5;
      } else {
        // Over budget — heavy penalty proportional to overage.
        const overage = listing.currentPriceUsdc / intent.entities.maxPriceUsdc;
        priceScore = Math.max(0, 1 - overage);
      }
    } else {
      // No constraint — score inversely within market range.
      const range = priceRange.max - priceRange.min;
      priceScore = range > 0
        ? 1 - (listing.currentPriceUsdc - priceRange.min) / range
        : 0.5;
    }

    // 4. Quality score: direct from composite.
    const qualityScore = listing.qualityScore;

    // 5. Popularity: log-normalized call volume.
    const popularityScore = maxCalls > 0
      ? Math.log(1 + listing.totalCalls) / Math.log(1 + maxCalls)
      : 0;

    // 6. Latency: inversely proportional (faster = better).
    let latencyScore: number;
    if (intent.entities.maxLatencyMs !== undefined) {
      latencyScore = listing.avgLatencyMs <= intent.entities.maxLatencyMs
        ? 1 - (listing.avgLatencyMs / intent.entities.maxLatencyMs) * 0.5
        : Math.max(0, 1 - listing.avgLatencyMs / intent.entities.maxLatencyMs);
    } else {
      latencyScore = maxLatency > 0
        ? 1 - listing.avgLatencyMs / maxLatency
        : 0.5;
    }

    // 7. Capability match: how many requested capabilities are in tags.
    const requestedCaps = intent.entities.capabilities;
    let capabilityMatch = 0;
    if (requestedCaps.length > 0) {
      const listingTags = new Set(listing.tags.map((t) => t.toLowerCase()));
      const matched = requestedCaps.filter((c) => listingTags.has(c.toLowerCase()));
      capabilityMatch = matched.length / requestedCaps.length;
    } else {
      capabilityMatch = 0.5; // Neutral if no capabilities requested.
    }

    return {
      textRelevance: clamp01(textRelevance),
      categoryMatch: clamp01(categoryMatch),
      priceScore: clamp01(priceScore),
      qualityScore: clamp01(qualityScore),
      popularityScore: clamp01(popularityScore),
      latencyScore: clamp01(latencyScore),
      capabilityMatch: clamp01(capabilityMatch),
    };
  }

  private computeComposite(
    breakdown: ScoreBreakdown,
    weights: RankingWeights
  ): number {
    return clamp01(
      breakdown.textRelevance * weights.textRelevance +
      breakdown.categoryMatch * weights.categoryMatch +
      breakdown.priceScore * weights.priceScore +
      breakdown.qualityScore * weights.qualityScore +
      breakdown.popularityScore * weights.popularityScore +
      breakdown.latencyScore * weights.latencyScore +
      breakdown.capabilityMatch * weights.capabilityMatch
    );
  }

  // ─────────────────────────────────────────────────────────
  // FILTERS
  // ─────────────────────────────────────────────────────────

  private passesFilters(
    listing: IndexedListing,
    entities: ClassifiedIntent["entities"]
  ): boolean {
    // Type filter.
    if (entities.listingType && listing.listingType !== entities.listingType) {
      return false;
    }

    // Capacity filter.
    if (
      entities.minCapacityRpm &&
      listing.capacityPerMinute < entities.minCapacityRpm
    ) {
      return false;
    }

    // Quality floor.
    if (entities.minQuality && listing.qualityScore < entities.minQuality) {
      return false;
    }

    // Provider name filter (fuzzy).
    if (entities.providerName) {
      const provNorm = listing.providerName.toLowerCase();
      const queryNorm = entities.providerName.toLowerCase();
      if (!provNorm.includes(queryNorm) && !queryNorm.includes(provNorm)) {
        return false;
      }
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────
  // SORT OVERRIDE
  // ─────────────────────────────────────────────────────────

  private applySortOverride(
    results: RankedMatch[],
    preference: string
  ): void {
    switch (preference) {
      case "PRICE_LOW":
        results.sort((a, b) =>
          a.listing.currentPriceUsdc - b.listing.currentPriceUsdc
        );
        break;
      case "PRICE_HIGH":
        results.sort((a, b) =>
          b.listing.currentPriceUsdc - a.listing.currentPriceUsdc
        );
        break;
      case "QUALITY":
        results.sort((a, b) =>
          b.listing.qualityScore - a.listing.qualityScore
        );
        break;
      case "POPULARITY":
        results.sort((a, b) =>
          b.listing.totalCalls - a.listing.totalCalls
        );
        break;
      case "LATENCY":
        results.sort((a, b) =>
          a.listing.avgLatencyMs - b.listing.avgLatencyMs
        );
        break;
      // RELEVANCE = default composite score, no re-sort.
    }
  }

  // ─────────────────────────────────────────────────────────
  // MATCH REASONS
  // ─────────────────────────────────────────────────────────

  private generateMatchReasons(
    breakdown: ScoreBreakdown,
    listing: IndexedListing,
    entities: ClassifiedIntent["entities"]
  ): string[] {
    const reasons: string[] = [];

    if (breakdown.textRelevance > 0.5) {
      reasons.push("Strong text relevance to your query");
    }
    if (breakdown.categoryMatch > 0.5) {
      reasons.push(`Matches category: ${listing.categorySlug}`);
    }
    if (breakdown.priceScore > 0.7 && entities.maxPriceUsdc) {
      reasons.push(`Within budget at $${listing.currentPriceUsdc.toFixed(6)}/call`);
    }
    if (breakdown.qualityScore > 0.8) {
      reasons.push(`High quality score: ${(listing.qualityScore * 100).toFixed(0)}%`);
    }
    if (breakdown.popularityScore > 0.7) {
      reasons.push(`Popular: ${listing.totalCalls.toLocaleString()} total calls`);
    }
    if (breakdown.latencyScore > 0.8) {
      reasons.push(`Fast: ${listing.avgLatencyMs}ms average latency`);
    }
    if (breakdown.capabilityMatch > 0.7 && entities.capabilities.length > 0) {
      reasons.push("Matches required capabilities");
    }
    if (listing.uptimePercent > 99.5) {
      reasons.push(`${listing.uptimePercent.toFixed(1)}% uptime`);
    }

    return reasons.length > 0 ? reasons : ["Matches general search criteria"];
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private getWeights(category: string): RankingWeights {
    return this.config.weightsByIntent[category] || this.config.defaultWeights;
  }

  private computePriceRange(listings: IndexedListing[]): { min: number; max: number } {
    let min = Infinity;
    let max = 0;
    for (const l of listings) {
      if (l.currentPriceUsdc < min) min = l.currentPriceUsdc;
      if (l.currentPriceUsdc > max) max = l.currentPriceUsdc;
    }
    return { min: min === Infinity ? 0 : min, max };
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
