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

import type { Prisma } from "@prisma/client";
import type { SemanticSearchResult, PriorityMode } from "./embeddings";
import { computeExplorationBonus } from "./cold-start-explorer";
import { computeRegionAffinity } from "./region-affinity";
import type { MetadataFilters } from "./metadata-filters";

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

function isProviderMatch(
  result: SemanticSearchResult,
  query: string,
  queryTokens: Set<string>,
): boolean {
  const providerLower = result.providerName.toLowerCase();
  if (providerLower.length >= 3 && query.includes(providerLower)) {
    return true;
  }

  const providerTokens = providerLower.split(/\s+/).filter((token) => token.length >= 3);
  return providerTokens.some((token) => queryTokens.has(token));
}

// ─── Tiebreaker Score ────────────────────────────────────────

function tiebreakerScore(
  result: SemanticSearchResult,
  priorityMode: PriorityMode,
  maxPrice: number,
  maxLatency: number,
): number {
  const qualityNorm = result.qualityScore;
  const trustNorm = result.trustScore;
  const priceNorm = maxPrice > 0 ? 1 - result.currentPriceUsdc / maxPrice : 0.5;
  const latencyNorm = maxLatency > 0 ? 1 - result.avgLatencyMs / maxLatency : 0.5;

  switch (priorityMode) {
    case "frugal":
      return priceNorm * 0.4 + qualityNorm * 0.2 + trustNorm * 0.25 + latencyNorm * 0.15;
    case "mission_critical":
      return qualityNorm * 0.3 + trustNorm * 0.4 + latencyNorm * 0.2 + priceNorm * 0.1;
    case "balanced":
    default:
      return qualityNorm * 0.25 + trustNorm * 0.35 + latencyNorm * 0.2 + priceNorm * 0.2;
  }
}

function trustBand(result: SemanticSearchResult): number {
  switch (result.trustState) {
    case "trusted":
      return 3;
    case "unproven":
      return 2;
    case "degraded":
      return 1;
    case "high_risk":
    default:
      return 0;
  }
}

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function activeDemandGapBoost(result: SemanticSearchResult): number {
  const metadata = result.domainMetadata;
  if (!isJsonObject(metadata)) return 0;

  const rootBoost = metadata.demandGapBoost;
  const rootExpiry = typeof metadata.boostExpiresAt === "string" ? metadata.boostExpiresAt : null;
  const nested = isJsonObject(metadata.nexusxDiscovery as Prisma.JsonValue | undefined)
    ? (metadata.nexusxDiscovery as Prisma.JsonObject)
    : null;

  const boostFlag = typeof rootBoost === "boolean"
    ? rootBoost
    : typeof nested?.demandGapBoost === "boolean"
      ? nested.demandGapBoost
      : false;
  const expiryValue = rootExpiry ?? (typeof nested?.boostExpiresAt === "string" ? nested.boostExpiresAt : null);

  if (!boostFlag || !expiryValue) return 0;

  const expiresAt = new Date(expiryValue);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return 0;
  }

  return 0.08;
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
  metadataFilters?: MetadataFilters,
): SemanticSearchResult[] {
  if (results.length === 0) return [];

  const queryTokens = new Set(
    query.toLowerCase().split(/\s+/).filter((t) => t.length > 0),
  );
  const normalizedQuery = query.toLowerCase();
  const maxPrice = Math.max(...results.map((r) => r.currentPriceUsdc), 0.000001);
  const maxLatency = Math.max(...results.map((r) => r.avgLatencyMs), 1);
  const totalImpressions = results.reduce(
    (sum, result) => sum + Math.max(result.discoveryImpressions, 0),
    0,
  );

  // Score each result
  const scored = results.map((result) => {
    const tier = classifyCapabilityTier(result, queryTokens);
    const tierRank = tier === "HIGH" ? 2 : tier === "MEDIUM" ? 1 : 0;
    const providerMatch = isProviderMatch(result, normalizedQuery, queryTokens) ? 1 : 0;
    const trustRank = trustBand(result);
    const tiebreaker = tiebreakerScore(result, priorityMode, maxPrice, maxLatency);
    const explorationBonus = computeExplorationBonus(
      {
        discoveryImpressions: result.discoveryImpressions,
        publishedAt: result.publishedAt,
        qualityScore: result.qualityScore,
      },
      totalImpressions,
    );
    const demandGapBoost = activeDemandGapBoost(result);
    const regionAffinity = computeRegionAffinity({
      availabilityRegion: metadataFilters?.availabilityRegion,
      availabilityRegions: result.availabilityRegions,
      domainMetadata: result.domainMetadata,
    });
    const withinTierScore = tiebreaker + explorationBonus + demandGapBoost + regionAffinity.score * 0.08;

    return { result, tierRank, providerMatch, trustRank, withinTierScore, regionAffinity };
  });

  // Lexicographic sort: tier → provider match → trust band → trust score → tiebreaker
  scored.sort((a, b) => {
    if (a.tierRank !== b.tierRank) return b.tierRank - a.tierRank;
    if (a.providerMatch !== b.providerMatch) return b.providerMatch - a.providerMatch;
    if (a.trustRank !== b.trustRank) return b.trustRank - a.trustRank;
    if (a.result.trustScore !== b.result.trustScore) return b.result.trustScore - a.result.trustScore;
    return b.withinTierScore - a.withinTierScore;
  });

  // Update composite scores to reflect the deterministic ranking
  return scored.map(({ result, tierRank, providerMatch, trustRank, withinTierScore, regionAffinity }, index) => ({
    ...result,
    regionAffinityScore: regionAffinity.score,
    regionAffinityReason: regionAffinity.reason,
    compositeScore:
      tierRank * 100 +
      providerMatch * 10 +
      trustRank * 2 +
      withinTierScore +
      (scored.length - index) * 0.0001,
  }));
}
