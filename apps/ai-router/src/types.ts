// ═══════════════════════════════════════════════════════════════
// NexusX — AI Router Types
// apps/ai-router/src/types.ts
//
// Shared types for the AI query router. The router takes
// natural language queries from buyers and matches them to
// the best provider listing(s) on the marketplace.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

/** High-level intent categories derived from buyer queries. */
export enum IntentCategory {
  /** Direct API access: "I need a translation API" */
  API_ACCESS = "API_ACCESS",
  /** Data procurement: "I need a dataset of restaurant reviews" */
  DATA_PROCUREMENT = "DATA_PROCUREMENT",
  /** Model inference: "Run inference on GPT-4 equivalent" */
  MODEL_INFERENCE = "MODEL_INFERENCE",
  /** Price comparison: "What's the cheapest sentiment analysis API?" */
  PRICE_COMPARISON = "PRICE_COMPARISON",
  /** Capability search: "Which APIs support function calling?" */
  CAPABILITY_SEARCH = "CAPABILITY_SEARCH",
  /** Recommendation: "Suggest the best API for my use case" */
  RECOMMENDATION = "RECOMMENDATION",
  /** General question about the platform */
  PLATFORM_QUERY = "PLATFORM_QUERY",
  /** Ambiguous or unclassifiable */
  UNKNOWN = "UNKNOWN",
}

/** Structured output from the intent classifier. */
export interface ClassifiedIntent {
  /** Primary intent category. */
  category: IntentCategory;
  /** Confidence score [0, 1]. */
  confidence: number;
  /** Extracted entities from the query. */
  entities: ExtractedEntities;
  /** Normalized version of the raw query. */
  normalizedQuery: string;
  /** Secondary intent if the query is multi-faceted. */
  secondaryCategory?: IntentCategory;
}

/** Entities extracted from the buyer's query. */
export interface ExtractedEntities {
  /** Desired listing type (REST_API, DATASET, MODEL_INFERENCE, etc). */
  listingType?: string;
  /** Category slugs or keywords (e.g. "nlp", "vision", "translation"). */
  categories: string[];
  /** Specific capability requirements (e.g. "function-calling", "streaming"). */
  capabilities: string[];
  /** Maximum price constraint (USDC per call). */
  maxPriceUsdc?: number;
  /** Minimum quality/uptime requirement [0, 1]. */
  minQuality?: number;
  /** Latency requirement in ms. */
  maxLatencyMs?: number;
  /** Throughput requirement (requests per minute). */
  minCapacityRpm?: number;
  /** Specific provider or model name mentioned. */
  providerName?: string;
  /** Free-form tags extracted. */
  tags: string[];
  /** Sort preference. */
  sortPreference?: SortPreference;
}

export enum SortPreference {
  PRICE_LOW = "PRICE_LOW",
  PRICE_HIGH = "PRICE_HIGH",
  QUALITY = "QUALITY",
  POPULARITY = "POPULARITY",
  LATENCY = "LATENCY",
  RELEVANCE = "RELEVANCE",
}

// ─────────────────────────────────────────────────────────────
// LISTING INDEX (in-memory representation for ranking)
// ─────────────────────────────────────────────────────────────

/** Lightweight listing representation for the ranking engine. */
export interface IndexedListing {
  id: string;
  slug: string;
  name: string;
  description: string;
  listingType: string;
  categorySlug: string;
  categoryPath: string[];   // Hierarchical path: ["ai", "nlp", "translation"]
  tags: string[];
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  capacityPerMinute: number;
  totalCalls: number;
  avgLatencyMs: number;
  qualityScore: number;     // Composite [0, 1] from QualitySnapshot
  uptimePercent: number;
  status: string;
  providerName: string;
  providerId: string;
}

// ─────────────────────────────────────────────────────────────
// ROUTING RESULTS
// ─────────────────────────────────────────────────────────────

/** A single ranked match returned by the router. */
export interface RankedMatch {
  listing: IndexedListing;
  /** Composite relevance score [0, 1]. */
  score: number;
  /** Breakdown of how the score was computed. */
  scoreBreakdown: ScoreBreakdown;
  /** Why this listing matched. */
  matchReasons: string[];
}

/** Score component breakdown for transparency. */
export interface ScoreBreakdown {
  textRelevance: number;    // [0, 1] — TF-IDF / keyword match
  categoryMatch: number;    // [0, 1] — taxonomy alignment
  priceScore: number;       // [0, 1] — price attractiveness
  qualityScore: number;     // [0, 1] — quality composite
  popularityScore: number;  // [0, 1] — normalized call volume
  latencyScore: number;     // [0, 1] — response speed
  capabilityMatch: number;  // [0, 1] — feature requirements met
}

/** Complete route result returned to the gateway or frontend. */
export interface RouteResult {
  /** Unique query ID for logging. */
  queryId: string;
  /** Original raw query. */
  rawQuery: string;
  /** Classified intent. */
  intent: ClassifiedIntent;
  /** Top matches, ranked by composite score. */
  matches: RankedMatch[];
  /** Total listings evaluated. */
  totalEvaluated: number;
  /** Time to compute the route (ms). */
  routeTimeMs: number;
  /** Alternative suggestions if no strong matches. */
  suggestions: string[];
}

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────

/** Weights for composite ranking score. Must sum to 1.0. */
export interface RankingWeights {
  textRelevance: number;
  categoryMatch: number;
  priceScore: number;
  qualityScore: number;
  popularityScore: number;
  latencyScore: number;
  capabilityMatch: number;
}

/** AI Router configuration. */
export interface RouterConfig {
  /** Maximum results to return. */
  maxResults: number;
  /** Minimum score threshold to include a match. */
  minScoreThreshold: number;
  /** Ranking weights per intent category. */
  weightsByIntent: Record<string, RankingWeights>;
  /** Default ranking weights. */
  defaultWeights: RankingWeights;
  /** Whether to use LLM for intent classification (vs rule-based). */
  useLlmClassifier: boolean;
  /** Anthropic API key for LLM classification. */
  anthropicApiKey: string;
  /** Model to use for classification. */
  classifierModel: string;
  /** Index refresh interval (ms). */
  indexRefreshIntervalMs: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  textRelevance: 0.30,
  categoryMatch: 0.20,
  priceScore: 0.15,
  qualityScore: 0.15,
  popularityScore: 0.10,
  latencyScore: 0.05,
  capabilityMatch: 0.05,
};

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  maxResults: 10,
  minScoreThreshold: 0.15,
  weightsByIntent: {
    [IntentCategory.PRICE_COMPARISON]: {
      textRelevance: 0.15,
      categoryMatch: 0.15,
      priceScore: 0.40,
      qualityScore: 0.10,
      popularityScore: 0.10,
      latencyScore: 0.05,
      capabilityMatch: 0.05,
    },
    [IntentCategory.CAPABILITY_SEARCH]: {
      textRelevance: 0.20,
      categoryMatch: 0.15,
      priceScore: 0.05,
      qualityScore: 0.15,
      popularityScore: 0.10,
      latencyScore: 0.05,
      capabilityMatch: 0.30,
    },
    [IntentCategory.MODEL_INFERENCE]: {
      textRelevance: 0.25,
      categoryMatch: 0.20,
      priceScore: 0.10,
      qualityScore: 0.20,
      popularityScore: 0.10,
      latencyScore: 0.10,
      capabilityMatch: 0.05,
    },
  },
  defaultWeights: DEFAULT_RANKING_WEIGHTS,
  useLlmClassifier: true,
  anthropicApiKey: "",
  classifierModel: "claude-sonnet-4-5-20250929",
  indexRefreshIntervalMs: 60_000,
};
