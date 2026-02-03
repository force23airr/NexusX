// ═══════════════════════════════════════════════════════════════
// NexusX — Intent Classifier
// apps/ai-router/src/services/intentClassifier.ts
//
// Dual-mode intent classification:
//   1. LLM mode: Uses Claude to classify intent and extract
//      entities from natural language queries.
//   2. Rule-based fallback: Pattern matching for when LLM is
//      unavailable or for low-latency classification.
//
// The classifier produces a ClassifiedIntent with category,
// confidence, and extracted entities (price constraints,
// capabilities, categories, etc).
// ═══════════════════════════════════════════════════════════════

import {
  IntentCategory,
  SortPreference,
  type ClassifiedIntent,
  type ExtractedEntities,
  type RouterConfig,
} from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Anthropic API message format. */
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class IntentClassifier {
  private config: RouterConfig;

  constructor(config: RouterConfig) {
    this.config = config;
  }

  /**
   * Classify a buyer's natural language query.
   *
   * @param rawQuery The buyer's query string.
   * @returns Classified intent with entities.
   */
  async classify(rawQuery: string): Promise<ClassifiedIntent> {
    const normalized = this.normalizeQuery(rawQuery);

    if (this.config.useLlmClassifier && this.config.anthropicApiKey) {
      try {
        return await this.classifyWithLlm(rawQuery, normalized);
      } catch (err) {
        console.warn("[IntentClassifier] LLM classification failed, falling back to rules:", err);
      }
    }

    return this.classifyWithRules(rawQuery, normalized);
  }

  // ─────────────────────────────────────────────────────────
  // LLM CLASSIFICATION
  // ─────────────────────────────────────────────────────────

  private async classifyWithLlm(
    rawQuery: string,
    normalized: string
  ): Promise<ClassifiedIntent> {
    const systemPrompt = `You are an intent classifier for NexusX, an AI data and API marketplace. Classify the buyer's query and extract structured entities.

Respond ONLY with a JSON object (no markdown, no backticks) with this exact schema:
{
  "category": "API_ACCESS" | "DATA_PROCUREMENT" | "MODEL_INFERENCE" | "PRICE_COMPARISON" | "CAPABILITY_SEARCH" | "RECOMMENDATION" | "PLATFORM_QUERY" | "UNKNOWN",
  "confidence": 0.0-1.0,
  "secondaryCategory": null | string,
  "entities": {
    "listingType": null | "REST_API" | "GRAPHQL_API" | "WEBSOCKET" | "DATASET" | "MODEL_INFERENCE" | "COMPOSITE",
    "categories": ["nlp", "vision", ...],
    "capabilities": ["function-calling", "streaming", ...],
    "maxPriceUsdc": null | number,
    "minQuality": null | 0.0-1.0,
    "maxLatencyMs": null | number,
    "minCapacityRpm": null | number,
    "providerName": null | string,
    "tags": [],
    "sortPreference": null | "PRICE_LOW" | "PRICE_HIGH" | "QUALITY" | "POPULARITY" | "LATENCY" | "RELEVANCE"
  }
}

Available listing types on the marketplace: REST APIs, GraphQL APIs, WebSocket streams, Datasets, Model Inference endpoints, and Composite (multi-step) services.

Categories include: nlp, vision, audio, translation, summarization, code-generation, embeddings, search, recommendation, analytics, geospatial, finance, healthcare, legal, and more.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.classifierModel,
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          { role: "user", content: rawQuery } as AnthropicMessage,
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data: AnthropicResponse = await response.json();
    const text = data.content[0]?.text || "{}";

    // Parse JSON response — strip any accidental markdown fences.
    const clean = text.replace(/```json\s*|```\s*/g, "").trim();
    const parsed = JSON.parse(clean);

    return {
      category: this.validateCategory(parsed.category),
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      normalizedQuery: normalized,
      secondaryCategory: parsed.secondaryCategory
        ? this.validateCategory(parsed.secondaryCategory)
        : undefined,
      entities: this.validateEntities(parsed.entities || {}),
    };
  }

  // ─────────────────────────────────────────────────────────
  // RULE-BASED CLASSIFICATION (FALLBACK)
  // ─────────────────────────────────────────────────────────

  classifyWithRules(
    rawQuery: string,
    normalized: string
  ): ClassifiedIntent {
    const lower = normalized.toLowerCase();
    const entities = this.extractEntitiesFromRules(lower);

    // Score each intent category.
    const scores = new Map<IntentCategory, number>();

    // PRICE_COMPARISON signals.
    if (this.matchesAny(lower, [
      "cheap", "cheapest", "price", "pricing", "cost", "afford",
      "budget", "under $", "less than", "lowest price", "compare price",
    ])) {
      scores.set(IntentCategory.PRICE_COMPARISON, 0.8);
    }

    // CAPABILITY_SEARCH signals.
    if (this.matchesAny(lower, [
      "support", "feature", "capability", "can it", "does it",
      "function calling", "streaming", "batch", "real-time",
    ])) {
      scores.set(IntentCategory.CAPABILITY_SEARCH,
        (scores.get(IntentCategory.CAPABILITY_SEARCH) || 0) + 0.7);
    }

    // MODEL_INFERENCE signals.
    if (this.matchesAny(lower, [
      "model", "inference", "gpt", "claude", "llama", "llm",
      "run", "generate", "predict", "completion",
    ])) {
      scores.set(IntentCategory.MODEL_INFERENCE,
        (scores.get(IntentCategory.MODEL_INFERENCE) || 0) + 0.75);
    }

    // DATA_PROCUREMENT signals.
    if (this.matchesAny(lower, [
      "dataset", "data set", "training data", "download data",
      "csv", "parquet", "json data", "corpus", "records",
    ])) {
      scores.set(IntentCategory.DATA_PROCUREMENT,
        (scores.get(IntentCategory.DATA_PROCUREMENT) || 0) + 0.8);
    }

    // API_ACCESS signals.
    if (this.matchesAny(lower, [
      "api", "endpoint", "rest", "graphql", "websocket",
      "integrate", "connect", "access", "call",
    ])) {
      scores.set(IntentCategory.API_ACCESS,
        (scores.get(IntentCategory.API_ACCESS) || 0) + 0.6);
    }

    // RECOMMENDATION signals.
    if (this.matchesAny(lower, [
      "recommend", "suggest", "best", "top", "which should",
      "what do you think", "ideal", "perfect for",
    ])) {
      scores.set(IntentCategory.RECOMMENDATION,
        (scores.get(IntentCategory.RECOMMENDATION) || 0) + 0.65);
    }

    // PLATFORM_QUERY signals.
    if (this.matchesAny(lower, [
      "how does nexusx", "how do i", "sign up", "pricing plan",
      "subscription", "account", "billing", "dashboard",
    ])) {
      scores.set(IntentCategory.PLATFORM_QUERY,
        (scores.get(IntentCategory.PLATFORM_QUERY) || 0) + 0.7);
    }

    // Find highest scoring category.
    let bestCategory = IntentCategory.UNKNOWN;
    let bestScore = 0;
    let secondCategory: IntentCategory | undefined;
    let secondScore = 0;

    for (const [category, score] of scores) {
      if (score > bestScore) {
        secondCategory = bestCategory !== IntentCategory.UNKNOWN ? bestCategory : undefined;
        secondScore = bestScore;
        bestCategory = category;
        bestScore = score;
      } else if (score > secondScore && category !== bestCategory) {
        secondCategory = category;
        secondScore = score;
      }
    }

    // If no strong signal, default to API_ACCESS for query-like inputs.
    if (bestScore < 0.3 && lower.length > 5) {
      bestCategory = IntentCategory.API_ACCESS;
      bestScore = 0.3;
    }

    return {
      category: bestCategory,
      confidence: Math.min(1, bestScore),
      normalizedQuery: normalized,
      secondaryCategory: secondScore > 0.4 ? secondCategory : undefined,
      entities,
    };
  }

  // ─────────────────────────────────────────────────────────
  // ENTITY EXTRACTION (RULES)
  // ─────────────────────────────────────────────────────────

  private extractEntitiesFromRules(lower: string): ExtractedEntities {
    const entities: ExtractedEntities = {
      categories: [],
      capabilities: [],
      tags: [],
    };

    // ─── Price constraints ───
    const priceMatch = lower.match(
      /(?:under|below|less than|max|at most|cheaper than)\s*\$?([\d.]+)/
    );
    if (priceMatch) {
      entities.maxPriceUsdc = parseFloat(priceMatch[1]);
    }

    // ─── Latency constraints ───
    const latencyMatch = lower.match(
      /(?:under|below|less than|within|max)\s*(\d+)\s*ms/
    );
    if (latencyMatch) {
      entities.maxLatencyMs = parseInt(latencyMatch[1], 10);
    }

    // ─── Throughput constraints ───
    const rpmMatch = lower.match(
      /(\d+)\s*(?:rpm|requests?\s*per\s*minute|req\/min)/
    );
    if (rpmMatch) {
      entities.minCapacityRpm = parseInt(rpmMatch[1], 10);
    }

    // ─── Listing type ───
    if (this.matchesAny(lower, ["dataset", "data set", "training data"])) {
      entities.listingType = "DATASET";
    } else if (this.matchesAny(lower, ["graphql"])) {
      entities.listingType = "GRAPHQL_API";
    } else if (this.matchesAny(lower, ["websocket", "ws://", "real-time stream"])) {
      entities.listingType = "WEBSOCKET";
    } else if (this.matchesAny(lower, ["model", "inference", "llm", "gpt", "completion"])) {
      entities.listingType = "MODEL_INFERENCE";
    } else if (this.matchesAny(lower, ["api", "rest", "endpoint"])) {
      entities.listingType = "REST_API";
    }

    // ─── Categories ───
    const categoryMap: Record<string, string> = {
      nlp: "nlp", "natural language": "nlp", text: "nlp",
      vision: "vision", image: "vision", "computer vision": "vision",
      audio: "audio", speech: "audio", "text-to-speech": "audio", tts: "audio",
      translation: "translation", translate: "translation",
      summarization: "summarization", summarize: "summarization",
      "code generation": "code-generation", coding: "code-generation",
      embedding: "embeddings", embeddings: "embeddings",
      search: "search", "semantic search": "search",
      sentiment: "sentiment-analysis", "sentiment analysis": "sentiment-analysis",
      classification: "classification", categorization: "classification",
      ocr: "ocr", "text extraction": "ocr",
      recommendation: "recommendation",
      finance: "finance", financial: "finance",
      healthcare: "healthcare", medical: "healthcare",
    };

    for (const [keyword, category] of Object.entries(categoryMap)) {
      if (lower.includes(keyword) && !entities.categories.includes(category)) {
        entities.categories.push(category);
      }
    }

    // ─── Capabilities ───
    const capabilityMap: Record<string, string> = {
      "function calling": "function-calling",
      "tool use": "function-calling",
      streaming: "streaming",
      batch: "batch-processing",
      "fine-tuning": "fine-tuning",
      "fine tuning": "fine-tuning",
      json: "json-output",
      "structured output": "json-output",
      multilingual: "multilingual",
      "context window": "large-context",
    };

    for (const [keyword, capability] of Object.entries(capabilityMap)) {
      if (lower.includes(keyword) && !entities.capabilities.includes(capability)) {
        entities.capabilities.push(capability);
      }
    }

    // ─── Sort preference ───
    if (this.matchesAny(lower, ["cheapest", "lowest price", "most affordable"])) {
      entities.sortPreference = SortPreference.PRICE_LOW;
    } else if (this.matchesAny(lower, ["best quality", "highest rated", "most reliable"])) {
      entities.sortPreference = SortPreference.QUALITY;
    } else if (this.matchesAny(lower, ["most popular", "most used", "trending"])) {
      entities.sortPreference = SortPreference.POPULARITY;
    } else if (this.matchesAny(lower, ["fastest", "lowest latency", "quickest"])) {
      entities.sortPreference = SortPreference.LATENCY;
    }

    // ─── Provider name ───
    const providerPatterns = [
      /(?:from|by|provider)\s+([a-zA-Z][a-zA-Z0-9-]+)/,
      /\b(openai|anthropic|google|meta|mistral|cohere|hugging\s*face)\b/i,
    ];
    for (const pattern of providerPatterns) {
      const match = lower.match(pattern);
      if (match) {
        entities.providerName = match[1].trim();
        break;
      }
    }

    return entities;
  }

  // ─────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────

  normalizeQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s$.,\-/]/g, "")
      .toLowerCase();
  }

  private matchesAny(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }

  private validateCategory(raw: string): IntentCategory {
    if (Object.values(IntentCategory).includes(raw as IntentCategory)) {
      return raw as IntentCategory;
    }
    return IntentCategory.UNKNOWN;
  }

  private validateEntities(raw: any): ExtractedEntities {
    return {
      listingType: typeof raw.listingType === "string" ? raw.listingType : undefined,
      categories: Array.isArray(raw.categories) ? raw.categories.filter((c: any) => typeof c === "string") : [],
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.filter((c: any) => typeof c === "string") : [],
      maxPriceUsdc: typeof raw.maxPriceUsdc === "number" ? raw.maxPriceUsdc : undefined,
      minQuality: typeof raw.minQuality === "number" ? raw.minQuality : undefined,
      maxLatencyMs: typeof raw.maxLatencyMs === "number" ? raw.maxLatencyMs : undefined,
      minCapacityRpm: typeof raw.minCapacityRpm === "number" ? raw.minCapacityRpm : undefined,
      providerName: typeof raw.providerName === "string" ? raw.providerName : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === "string") : [],
      sortPreference: raw.sortPreference as SortPreference | undefined,
    };
  }
}
