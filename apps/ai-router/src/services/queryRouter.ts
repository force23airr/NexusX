// ═══════════════════════════════════════════════════════════════
// NexusX — Query Router
// apps/ai-router/src/services/queryRouter.ts
//
// Main orchestrator for the AI routing pipeline:
//   1. Classify intent (LLM or rule-based)
//   2. Rank listings (multi-factor scoring)
//   3. Filter + limit results
//   4. Generate suggestions for weak matches
//   5. Log the query for feedback loop
//
// Entry point: router.route(buyerId, rawQuery) → RouteResult
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import {
  IntentCategory,
  type RouteResult,
  type RankedMatch,
  type RouterConfig,
  DEFAULT_ROUTER_CONFIG,
} from "../types";
import { IntentClassifier } from "./intentClassifier";
import { ListingIndex, type ListingLoaderFn } from "./listingIndex";
import { RankingEngine } from "./rankingEngine";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Persists a query log to the database (maps to QueryLog model). */
export interface QueryLogRecord {
  id: string;
  buyerId: string;
  rawQuery: string;
  normalizedQuery: string;
  intentClassified: string;
  matchedListingId: string | null;
  confidenceScore: number;
  alternativeIds: string[];
  routeTimeMs: number;
}

export type QueryLogPersistFn = (record: QueryLogRecord) => Promise<void>;

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class QueryRouter {
  private classifier: IntentClassifier;
  private index: ListingIndex;
  private ranker: RankingEngine;
  private config: RouterConfig;
  private logQuery: QueryLogPersistFn;

  constructor(
    listingLoader: ListingLoaderFn,
    logQuery: QueryLogPersistFn,
    config?: Partial<RouterConfig>
  ) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
    this.classifier = new IntentClassifier(this.config);
    this.index = new ListingIndex(listingLoader, this.config.indexRefreshIntervalMs);
    this.ranker = new RankingEngine(this.index, this.config);
    this.logQuery = logQuery;
  }

  /**
   * Initialize the router — loads the listing index.
   * Call once at startup before routing queries.
   */
  async initialize(): Promise<void> {
    await this.index.refresh();
    console.log("[QueryRouter] Initialized.", this.index.stats());
  }

  /**
   * Route a buyer's natural language query to the best listing(s).
   *
   * @param buyerId  Buyer's user ID.
   * @param rawQuery Natural language query string.
   * @returns Complete route result with ranked matches.
   */
  async route(buyerId: string, rawQuery: string): Promise<RouteResult> {
    const startTime = performance.now();
    const queryId = randomUUID();

    // ─── 1. Classify intent ───
    const intent = await this.classifier.classify(rawQuery);

    // ─── 2. Handle platform queries differently ───
    if (intent.category === IntentCategory.PLATFORM_QUERY) {
      const routeTimeMs = Math.round(performance.now() - startTime);
      const result: RouteResult = {
        queryId,
        rawQuery,
        intent,
        matches: [],
        totalEvaluated: 0,
        routeTimeMs,
        suggestions: [
          "Visit our docs at /docs for platform information.",
          "Check /pricing for listing prices.",
          "Use /status for gateway health.",
        ],
      };
      this.persistLog(queryId, buyerId, result);
      return result;
    }

    // ─── 3. Rank listings ───
    const allMatches = this.ranker.rank(intent);

    // ─── 4. Filter by score threshold ───
    const filteredMatches = allMatches.filter(
      (m) => m.score >= this.config.minScoreThreshold
    );

    // ─── 5. Limit results ───
    const topMatches = filteredMatches.slice(0, this.config.maxResults);

    // ─── 6. Generate suggestions for weak results ───
    const suggestions = this.generateSuggestions(intent, topMatches, allMatches.length);

    const routeTimeMs = Math.round(performance.now() - startTime);

    const result: RouteResult = {
      queryId,
      rawQuery,
      intent,
      matches: topMatches,
      totalEvaluated: allMatches.length,
      routeTimeMs,
      suggestions,
    };

    // ─── 7. Log (fire-and-forget) ───
    this.persistLog(queryId, buyerId, result);

    return result;
  }

  /**
   * Record that a buyer accepted a routed listing.
   * Used to improve future ranking (feedback loop).
   */
  async recordAcceptance(queryId: string, listingId: string): Promise<void> {
    // In production, update the QueryLog.wasAccepted field
    // and use this data to tune ranking weights.
    console.log(`[QueryRouter] Acceptance recorded: query=${queryId} listing=${listingId}`);
  }

  /**
   * Force refresh the listing index.
   */
  async refreshIndex(): Promise<void> {
    await this.index.refresh();
  }

  /**
   * Get index stats for monitoring.
   */
  stats() {
    return {
      index: this.index.stats(),
      config: {
        maxResults: this.config.maxResults,
        minScoreThreshold: this.config.minScoreThreshold,
        useLlmClassifier: this.config.useLlmClassifier,
        classifierModel: this.config.classifierModel,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // SUGGESTIONS
  // ─────────────────────────────────────────────────────────

  private generateSuggestions(
    intent: any,
    topMatches: RankedMatch[],
    totalEvaluated: number
  ): string[] {
    const suggestions: string[] = [];

    if (topMatches.length === 0 && totalEvaluated === 0) {
      suggestions.push("No listings found. The marketplace may be loading — try again shortly.");
      return suggestions;
    }

    if (topMatches.length === 0) {
      suggestions.push("No strong matches found for your query.");

      if (intent.entities.maxPriceUsdc) {
        suggestions.push(
          `Try increasing your budget above $${intent.entities.maxPriceUsdc.toFixed(4)}/call.`
        );
      }
      if (intent.entities.capabilities.length > 0) {
        suggestions.push(
          `Relax capability requirements: ${intent.entities.capabilities.join(", ")}.`
        );
      }
      if (intent.entities.listingType) {
        suggestions.push("Try removing the listing type filter for broader results.");
      }

      return suggestions;
    }

    if (topMatches.length > 0 && topMatches[0].score < 0.4) {
      suggestions.push("Matches are approximate. Try being more specific in your query.");
    }

    if (topMatches.length === 1) {
      suggestions.push("Only one match found. Try broadening your search for alternatives.");
    }

    if (intent.confidence < 0.5) {
      suggestions.push(
        "Your query was ambiguous. Try specifying the type of service you need (API, dataset, model)."
      );
    }

    return suggestions;
  }

  // ─────────────────────────────────────────────────────────
  // LOGGING
  // ─────────────────────────────────────────────────────────

  private persistLog(
    queryId: string,
    buyerId: string,
    result: RouteResult
  ): void {
    const topMatch = result.matches[0];

    const record: QueryLogRecord = {
      id: queryId,
      buyerId,
      rawQuery: result.rawQuery,
      normalizedQuery: result.intent.normalizedQuery,
      intentClassified: result.intent.category,
      matchedListingId: topMatch?.listing.id || null,
      confidenceScore: result.intent.confidence,
      alternativeIds: result.matches.slice(1, 6).map((m) => m.listing.id),
      routeTimeMs: result.routeTimeMs,
    };

    this.logQuery(record).catch((err) =>
      console.error("[QueryRouter] Log persist error:", err)
    );
  }

  destroy(): void {
    this.index.destroy();
  }
}
