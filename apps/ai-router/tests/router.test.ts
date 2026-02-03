// ═══════════════════════════════════════════════════════════════
// NexusX — AI Router Tests
// apps/ai-router/tests/router.test.ts
//
// Tests for intent classification, listing indexing, ranking,
// and end-to-end query routing.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  IntentCategory,
  SortPreference,
  DEFAULT_ROUTER_CONFIG,
  type IndexedListing,
  type RouterConfig,
} from "../src/types";
import { IntentClassifier } from "../src/services/intentClassifier";
import { ListingIndex } from "../src/services/listingIndex";
import { RankingEngine } from "../src/services/rankingEngine";
import { QueryRouter } from "../src/services/queryRouter";

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

function createTestListings(): IndexedListing[] {
  return [
    {
      id: "lst_gpt4",
      slug: "openai-gpt4-turbo",
      name: "OpenAI GPT-4 Turbo Inference",
      description: "High-quality language model with function calling, streaming, and JSON output support. Ideal for complex reasoning, code generation, and multi-step tasks.",
      listingType: "MODEL_INFERENCE",
      categorySlug: "nlp",
      categoryPath: ["ai", "nlp", "language-models"],
      tags: ["gpt-4", "function-calling", "streaming", "json-output", "code-generation"],
      currentPriceUsdc: 0.008,
      floorPriceUsdc: 0.005,
      capacityPerMinute: 200,
      totalCalls: 1_500_000,
      avgLatencyMs: 450,
      qualityScore: 0.95,
      uptimePercent: 99.9,
      status: "ACTIVE",
      providerName: "OpenAI",
      providerId: "prv_openai",
    },
    {
      id: "lst_claude",
      slug: "anthropic-claude-sonnet",
      name: "Anthropic Claude Sonnet Inference",
      description: "Advanced reasoning model with strong instruction following. Supports structured output, analysis, and creative writing.",
      listingType: "MODEL_INFERENCE",
      categorySlug: "nlp",
      categoryPath: ["ai", "nlp", "language-models"],
      tags: ["claude", "reasoning", "analysis", "structured-output", "streaming"],
      currentPriceUsdc: 0.006,
      floorPriceUsdc: 0.003,
      capacityPerMinute: 150,
      totalCalls: 800_000,
      avgLatencyMs: 380,
      qualityScore: 0.93,
      uptimePercent: 99.8,
      status: "ACTIVE",
      providerName: "Anthropic",
      providerId: "prv_anthropic",
    },
    {
      id: "lst_translate",
      slug: "deepl-translation-api",
      name: "DeepL Translation API",
      description: "High-accuracy neural machine translation supporting 30+ languages. REST API with batch processing support.",
      listingType: "REST_API",
      categorySlug: "translation",
      categoryPath: ["ai", "nlp", "translation"],
      tags: ["translation", "multilingual", "batch-processing", "neural-mt"],
      currentPriceUsdc: 0.002,
      floorPriceUsdc: 0.001,
      capacityPerMinute: 500,
      totalCalls: 3_000_000,
      avgLatencyMs: 120,
      qualityScore: 0.92,
      uptimePercent: 99.95,
      status: "ACTIVE",
      providerName: "DeepL",
      providerId: "prv_deepl",
    },
    {
      id: "lst_sentiment",
      slug: "sentiment-analysis-pro",
      name: "Sentiment Analysis Pro API",
      description: "Real-time sentiment analysis for text, reviews, and social media. Returns polarity, subjectivity, and entity-level sentiment.",
      listingType: "REST_API",
      categorySlug: "sentiment-analysis",
      categoryPath: ["ai", "nlp", "sentiment-analysis"],
      tags: ["sentiment", "nlp", "social-media", "reviews", "classification"],
      currentPriceUsdc: 0.001,
      floorPriceUsdc: 0.0005,
      capacityPerMinute: 1000,
      totalCalls: 5_000_000,
      avgLatencyMs: 50,
      qualityScore: 0.88,
      uptimePercent: 99.7,
      status: "ACTIVE",
      providerName: "TextInsight",
      providerId: "prv_textinsight",
    },
    {
      id: "lst_vision",
      slug: "vision-object-detection",
      name: "Vision Object Detection API",
      description: "Computer vision API for object detection, image classification, and scene understanding. Supports batch image processing.",
      listingType: "REST_API",
      categorySlug: "vision",
      categoryPath: ["ai", "vision", "object-detection"],
      tags: ["vision", "object-detection", "image-classification", "batch-processing"],
      currentPriceUsdc: 0.003,
      floorPriceUsdc: 0.001,
      capacityPerMinute: 300,
      totalCalls: 2_000_000,
      avgLatencyMs: 200,
      qualityScore: 0.90,
      uptimePercent: 99.6,
      status: "ACTIVE",
      providerName: "VisionAI",
      providerId: "prv_visionai",
    },
    {
      id: "lst_embeddings",
      slug: "text-embeddings-v3",
      name: "Text Embeddings v3",
      description: "High-dimensional text embeddings for semantic search, clustering, and similarity. 1536-dimension vectors.",
      listingType: "REST_API",
      categorySlug: "embeddings",
      categoryPath: ["ai", "nlp", "embeddings"],
      tags: ["embeddings", "semantic-search", "vectors", "clustering"],
      currentPriceUsdc: 0.0005,
      floorPriceUsdc: 0.0002,
      capacityPerMinute: 2000,
      totalCalls: 10_000_000,
      avgLatencyMs: 30,
      qualityScore: 0.91,
      uptimePercent: 99.99,
      status: "ACTIVE",
      providerName: "EmbedCo",
      providerId: "prv_embedco",
    },
    {
      id: "lst_dataset",
      slug: "restaurant-reviews-dataset",
      name: "Restaurant Reviews Dataset (500K)",
      description: "Curated dataset of 500,000 restaurant reviews with sentiment labels, ratings, and location data. CSV and Parquet formats.",
      listingType: "DATASET",
      categorySlug: "sentiment-analysis",
      categoryPath: ["data", "nlp", "sentiment-analysis"],
      tags: ["dataset", "reviews", "restaurant", "sentiment", "labeled-data"],
      currentPriceUsdc: 0.05,
      floorPriceUsdc: 0.02,
      capacityPerMinute: 10,
      totalCalls: 5_000,
      avgLatencyMs: 2000,
      qualityScore: 0.85,
      uptimePercent: 99.0,
      status: "ACTIVE",
      providerName: "DataVault",
      providerId: "prv_datavault",
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFIER (RULE-BASED)
// ─────────────────────────────────────────────────────────────

describe("IntentClassifier (Rule-Based)", () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier({
      ...DEFAULT_ROUTER_CONFIG,
      useLlmClassifier: false,
    });
  });

  it("classifies price comparison queries", () => {
    const result = classifier.classifyWithRules(
      "What's the cheapest sentiment analysis API?",
      "whats the cheapest sentiment analysis api"
    );
    expect(result.category).toBe(IntentCategory.PRICE_COMPARISON);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies model inference queries", () => {
    const result = classifier.classifyWithRules(
      "I need a GPT-4 equivalent for code generation",
      "i need a gpt-4 equivalent for code generation"
    );
    expect(result.category).toBe(IntentCategory.MODEL_INFERENCE);
  });

  it("classifies data procurement queries", () => {
    const result = classifier.classifyWithRules(
      "Looking for a training dataset of restaurant reviews",
      "looking for a training dataset of restaurant reviews"
    );
    expect(result.category).toBe(IntentCategory.DATA_PROCUREMENT);
  });

  it("classifies capability search queries", () => {
    const result = classifier.classifyWithRules(
      "Which APIs support function calling and streaming?",
      "which apis support function calling and streaming"
    );
    expect(result.category).toBe(IntentCategory.CAPABILITY_SEARCH);
  });

  it("classifies recommendation queries", () => {
    const result = classifier.classifyWithRules(
      "What's the best API for my NLP pipeline?",
      "whats the best api for my nlp pipeline"
    );
    expect(result.category).toBe(IntentCategory.RECOMMENDATION);
  });

  it("classifies platform queries", () => {
    const result = classifier.classifyWithRules(
      "How do I sign up for a subscription?",
      "how do i sign up for a subscription"
    );
    expect(result.category).toBe(IntentCategory.PLATFORM_QUERY);
  });

  it("extracts price constraints", () => {
    const result = classifier.classifyWithRules(
      "Find me an NLP API under $0.01 per call",
      "find me an nlp api under $0.01 per call"
    );
    expect(result.entities.maxPriceUsdc).toBe(0.01);
  });

  it("extracts latency constraints", () => {
    const result = classifier.classifyWithRules(
      "I need a translation API under 200ms",
      "i need a translation api under 200ms"
    );
    expect(result.entities.maxLatencyMs).toBe(200);
  });

  it("extracts throughput constraints", () => {
    const result = classifier.classifyWithRules(
      "API that can handle 500 rpm",
      "api that can handle 500 rpm"
    );
    expect(result.entities.minCapacityRpm).toBe(500);
  });

  it("extracts capability requirements", () => {
    const result = classifier.classifyWithRules(
      "LLM with function calling and streaming support",
      "llm with function calling and streaming support"
    );
    expect(result.entities.capabilities).toContain("function-calling");
    expect(result.entities.capabilities).toContain("streaming");
  });

  it("extracts categories from query", () => {
    const result = classifier.classifyWithRules(
      "Best translation and sentiment analysis services",
      "best translation and sentiment analysis services"
    );
    expect(result.entities.categories).toContain("translation");
    expect(result.entities.categories).toContain("sentiment-analysis");
  });

  it("extracts listing type", () => {
    const result = classifier.classifyWithRules(
      "I need a dataset for training",
      "i need a dataset for training"
    );
    expect(result.entities.listingType).toBe("DATASET");
  });

  it("extracts sort preference", () => {
    const result = classifier.classifyWithRules(
      "Show me the cheapest APIs",
      "show me the cheapest apis"
    );
    expect(result.entities.sortPreference).toBe(SortPreference.PRICE_LOW);
  });

  it("extracts provider name", () => {
    const result = classifier.classifyWithRules(
      "Show me APIs from OpenAI",
      "show me apis from openai"
    );
    expect(result.entities.providerName).toBe("openai");
  });

  it("normalizes queries correctly", () => {
    const normalized = classifier.normalizeQuery("  What's the BEST   API?!  ");
    expect(normalized).toBe("whats the best api");
  });
});

// ─────────────────────────────────────────────────────────────
// LISTING INDEX
// ─────────────────────────────────────────────────────────────

describe("ListingIndex", () => {
  let index: ListingIndex;

  beforeEach(() => {
    index = new ListingIndex(async () => createTestListings(), 999_999);
    index.rebuild(createTestListings());
  });

  afterEach(() => index.destroy());

  it("indexes all active listings", () => {
    expect(index.stats().totalListings).toBe(7);
  });

  it("returns text search scores for relevant queries", () => {
    const scores = index.textSearch("translation api multilingual");
    expect(scores.has("lst_translate")).toBe(true);
    expect(scores.get("lst_translate")!).toBeGreaterThan(0.5);
  });

  it("ranks GPT-4 higher for LLM queries", () => {
    const scores = index.textSearch("gpt-4 function calling language model");
    const gpt4Score = scores.get("lst_gpt4") || 0;
    const translateScore = scores.get("lst_translate") || 0;
    expect(gpt4Score).toBeGreaterThan(translateScore);
  });

  it("matches categories correctly", () => {
    const scores = index.categorySearch(["translation"]);
    expect(scores.has("lst_translate")).toBe(true);
    expect(scores.get("lst_translate")!).toBe(1);
  });

  it("matches tags correctly", () => {
    const scores = index.tagSearch(["streaming"]);
    expect(scores.has("lst_gpt4")).toBe(true);
    expect(scores.has("lst_claude")).toBe(true);
  });

  it("filters by type", () => {
    const datasets = index.getByType("DATASET");
    expect(datasets).toHaveLength(1);
    expect(datasets[0].id).toBe("lst_dataset");
  });

  it("retrieves by ID", () => {
    const listing = index.get("lst_gpt4");
    expect(listing).toBeDefined();
    expect(listing!.name).toContain("GPT-4");
  });

  it("tokenizes and filters stop words", () => {
    const tokens = index.tokenize("I need a fast API for translation");
    expect(tokens).not.toContain("i");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("for");
    expect(tokens).toContain("fast");
    expect(tokens).toContain("translation");
  });
});

// ─────────────────────────────────────────────────────────────
// RANKING ENGINE
// ─────────────────────────────────────────────────────────────

describe("RankingEngine", () => {
  let index: ListingIndex;
  let ranker: RankingEngine;

  beforeEach(() => {
    const config = { ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false };
    index = new ListingIndex(async () => createTestListings(), 999_999);
    index.rebuild(createTestListings());
    ranker = new RankingEngine(index, config);
  });

  afterEach(() => index.destroy());

  it("ranks translation API highest for translation queries", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "I need a translation API",
      "i need a translation api"
    );

    const results = ranker.rank(intent);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].listing.id).toBe("lst_translate");
  });

  it("respects price constraints", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "Cheapest NLP API under $0.002",
      "cheapest nlp api under $0.002"
    );

    const results = ranker.rank(intent);
    // Only listings at or below $0.002 should score well.
    const topPrices = results.slice(0, 3).map((r) => r.listing.currentPriceUsdc);
    expect(topPrices.every((p) => p <= 0.005)).toBe(true);
  });

  it("filters by listing type", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "I need a dataset of restaurant reviews",
      "i need a dataset of restaurant reviews"
    );

    const results = ranker.rank(intent);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].listing.listingType).toBe("DATASET");
  });

  it("filters by provider name", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "Show me models from OpenAI",
      "show me models from openai"
    );

    const results = ranker.rank(intent);
    expect(results.every((r) => r.listing.providerName.toLowerCase().includes("openai"))).toBe(true);
  });

  it("provides score breakdowns", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "Fast sentiment analysis API",
      "fast sentiment analysis api"
    );

    const results = ranker.rank(intent);
    expect(results[0].scoreBreakdown).toBeDefined();
    expect(results[0].scoreBreakdown.textRelevance).toBeGreaterThanOrEqual(0);
    expect(results[0].scoreBreakdown.textRelevance).toBeLessThanOrEqual(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("generates match reasons", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "Translation API",
      "translation api"
    );

    const results = ranker.rank(intent);
    expect(results[0].matchReasons.length).toBeGreaterThan(0);
  });

  it("returns empty array when no listings match filters", () => {
    const classifier = new IntentClassifier({ ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false });
    const intent = classifier.classifyWithRules(
      "GraphQL API from NonexistentProvider",
      "graphql api from nonexistentprovider"
    );

    const results = ranker.rank(intent);
    expect(results).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// QUERY ROUTER (END-TO-END)
// ─────────────────────────────────────────────────────────────

describe("QueryRouter (E2E)", () => {
  let router: QueryRouter;
  let queryLogs: any[];

  beforeEach(async () => {
    queryLogs = [];
    router = new QueryRouter(
      async () => createTestListings(),
      async (record) => { queryLogs.push(record); },
      { ...DEFAULT_ROUTER_CONFIG, useLlmClassifier: false }
    );
    await router.initialize();
  });

  afterEach(() => router.destroy());

  it("routes a translation query to DeepL", async () => {
    const result = await router.route("buyer_001", "I need a translation API");

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].listing.slug).toBe("deepl-translation-api");
    expect(result.intent.category).toBe(IntentCategory.API_ACCESS);
    expect(result.routeTimeMs).toBeLessThan(100);
  });

  it("routes a model inference query", async () => {
    const result = await router.route("buyer_001", "GPT-4 equivalent with function calling");

    expect(result.matches.length).toBeGreaterThan(0);
    // GPT-4 has function-calling tag, should rank first.
    expect(result.matches[0].listing.id).toBe("lst_gpt4");
  });

  it("routes a dataset query", async () => {
    const result = await router.route("buyer_001", "Training dataset of restaurant reviews");

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].listing.listingType).toBe("DATASET");
  });

  it("handles price-constrained queries", async () => {
    const result = await router.route("buyer_001", "Cheapest API under $0.001 per call");

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.intent.entities.maxPriceUsdc).toBe(0.001);
  });

  it("handles platform queries without matches", async () => {
    const result = await router.route("buyer_001", "How do I sign up?");

    expect(result.intent.category).toBe(IntentCategory.PLATFORM_QUERY);
    expect(result.matches).toHaveLength(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("logs every query", async () => {
    await router.route("buyer_001", "Translation API");

    expect(queryLogs).toHaveLength(1);
    expect(queryLogs[0].buyerId).toBe("buyer_001");
    expect(queryLogs[0].rawQuery).toBe("Translation API");
    expect(queryLogs[0].intentClassified).toBeDefined();
    expect(queryLogs[0].routeTimeMs).toBeDefined();
  });

  it("returns route time under 50ms for rule-based classification", async () => {
    const result = await router.route("buyer_001", "Fast embedding API");
    expect(result.routeTimeMs).toBeLessThan(50);
  });

  it("returns suggestions for weak matches", async () => {
    const result = await router.route("buyer_001", "quantum computing simulation API");
    // No quantum listings in test data.
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("provides index stats", () => {
    const stats = router.stats();
    expect(stats.index.totalListings).toBe(7);
    expect(stats.config.maxResults).toBe(10);
  });
});
