// ═══════════════════════════════════════════════════════════════
// NexusX — Deterministic Ranker
// packages/database/src/deterministic-ranker.ts
//
// Bucket-sort ranker with hard priority ordering. A correct
// result NEVER loses to a cheaper-but-wrong result because
// capability tier is the primary sort key.
//
// Priority ordering:
//   1. Eligibility fit (metadata filters already handled upstream)
//   2. Capability fit (HIGH / MEDIUM / LOW tier)
//   3. Exact provider/domain match
//   4. Latency/quality
//   5. Price
// ═══════════════════════════════════════════════════════════════

import type { SemanticSearchResult, PriorityMode } from "./embeddings";

// ─── Capability Tiers ────────────────────────────────────────

type CapabilityTier = "HIGH" | "MEDIUM" | "LOW";

function classifyCapabilityTier(
  result: SemanticSearchResult,
  queryTokens: Set<string>,
): CapabilityTier {
  // HIGH: exact intent match OR very high semantic similarity
  const intentTokens = new Set(result.intents.map((i) => i.toLowerCase()));
  const hasIntentMatch = Array.from(queryTokens).some((qt) => intentTokens.has(qt));
  if (hasIntentMatch || result.similarity >= 0.8) {
    return "HIGH";
  }

  // MEDIUM: tag overlap > 50% OR category match via composite score indicator
  const tagTokens = new Set(result.tags.map((t) => t.toLowerCase()));
  const tagOverlap = queryTokens.size > 0
    ? Array.from(queryTokens).filter((qt) => tagTokens.has(qt)).length / queryTokens.size
    : 0;
  if (tagOverlap >= 0.5 || result.similarity >= 0.6) {
    return "MEDIUM";
  }

  return "LOW";
}

// ─── Provider Match ──────────────────────────────────────────

function isProviderMatch(result: SemanticSearchResult, queryTokens: Set<string>): boolean {
  const providerLower = result.providerName.toLowerCase();
  return Array.from(queryTokens).some(
    (qt) => qt.length >= 3 && providerLower.includes(qt),
  );
}

// ─── Tiebreaker Score ────────────────────────────────────────

function tiebreakerScore(
  result: SemanticSearchResult,
  priorityMode: PriorityMode,
  maxPrice: number,
): number {
  const qualityNorm = result.qualityScore; // 0-1
  const priceNorm = maxPrice > 0 ? 1 - result.currentPriceUsdc / maxPrice : 0.5;

  switch (priorityMode) {
    case "frugal":
      return priceNorm * 0.6 + qualityNorm * 0.4;
    case "mission_critical":
      return qualityNorm * 0.7 + priceNorm * 0.3;
    case "balanced":
    default:
      return qualityNorm * 0.5 + priceNorm * 0.5;
  }
}

// ─── Main Ranker ─────────────────────────────────────────────

/**
 * Deterministic ranking with hard priority ordering.
 * Sorts results into capability tiers, then within each tier
 * applies provider match, quality, and price tiebreakers.
 */
export function deterministicRank(
  results: SemanticSearchResult[],
  query: string,
  priorityMode: PriorityMode = "balanced",
): SemanticSearchResult[] {
  if (results.length === 0) return [];

  const queryTokens = new Set(
    query.toLowerCase().split(/\s+/).filter((t) => t.length > 0),
  );
  const maxPrice = Math.max(...results.map((r) => r.currentPriceUsdc), 0.000001);

  // Score each result
  const scored = results.map((result) => {
    const tier = classifyCapabilityTier(result, queryTokens);
    const tierRank = tier === "HIGH" ? 2 : tier === "MEDIUM" ? 1 : 0;
    const providerMatch = isProviderMatch(result, queryTokens) ? 1 : 0;
    const tiebreaker = tiebreakerScore(result, priorityMode, maxPrice);

    return { result, tierRank, providerMatch, tiebreaker };
  });

  // Lexicographic sort: tier (desc) → provider match (desc) → tiebreaker (desc)
  scored.sort((a, b) => {
    if (a.tierRank !== b.tierRank) return b.tierRank - a.tierRank;
    if (a.providerMatch !== b.providerMatch) return b.providerMatch - a.providerMatch;
    return b.tiebreaker - a.tiebreaker;
  });

  // Update composite scores to reflect the deterministic ranking
  return scored.map(({ result, tierRank, tiebreaker }, index) => ({
    ...result,
    compositeScore: tierRank + tiebreaker + (scored.length - index) * 0.0001,
  }));
}
