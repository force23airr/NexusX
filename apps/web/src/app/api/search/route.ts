// ═══════════════════════════════════════════════════════════════
// NexusX — AI Search API Route
// apps/web/src/app/api/search/route.ts
//
// Self-contained AI Router endpoint. Implements:
//   1. Intent classification (rule-based + optional LLM via Claude)
//   2. Listing indexing with TF-IDF text search
//   3. Multi-factor ranking (7 scoring dimensions)
//   4. Match reason generation
//
// POST { query: string } → RouteResult
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";


// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ExtractedEntities {
  listingType?: string;
  categories: string[];
  capabilities: string[];
  maxPriceUsdc?: number;
  minQuality?: number;
  maxLatencyMs?: number;
  minCapacityRpm?: number;
  providerName?: string;
  tags: string[];
  sortPreference?: string;
}

interface ClassifiedIntent {
  category: string;
  confidence: number;
  entities: ExtractedEntities;
  normalizedQuery: string;
  secondaryCategory?: string;
}

interface IndexedListing {
  id: string;
  slug: string;
  name: string;
  description: string;
  listingType: string;
  categorySlug: string;
  tags: string[];
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  capacityPerMinute: number;
  totalCalls: number;
  avgLatencyMs: number;
  qualityScore: number;
  uptimePercent: number;
  status: string;
  providerName: string;
  providerId: string;
}

interface ScoreBreakdown {
  textRelevance: number;
  categoryMatch: number;
  priceScore: number;
  qualityScore: number;
  popularityScore: number;
  latencyScore: number;
  capabilityMatch: number;
}

interface RankedMatch {
  listing: IndexedListing;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  matchReasons: string[];
}

const DEFAULT_WEIGHTS = {
  textRelevance: 0.30,
  categoryMatch: 0.20,
  priceScore: 0.15,
  qualityScore: 0.15,
  popularityScore: 0.10,
  latencyScore: 0.05,
  capabilityMatch: 0.05,
};

const INTENT_WEIGHTS: Record<string, typeof DEFAULT_WEIGHTS> = {
  PRICE_COMPARISON: {
    textRelevance: 0.15, categoryMatch: 0.15, priceScore: 0.40,
    qualityScore: 0.10, popularityScore: 0.10, latencyScore: 0.05, capabilityMatch: 0.05,
  },
  CAPABILITY_SEARCH: {
    textRelevance: 0.20, categoryMatch: 0.15, priceScore: 0.05,
    qualityScore: 0.15, popularityScore: 0.10, latencyScore: 0.05, capabilityMatch: 0.30,
  },
  MODEL_INFERENCE: {
    textRelevance: 0.25, categoryMatch: 0.20, priceScore: 0.10,
    qualityScore: 0.20, popularityScore: 0.10, latencyScore: 0.10, capabilityMatch: 0.05,
  },
};

// ─────────────────────────────────────────────────────────────
// STOP WORDS
// ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "it", "as", "be", "was", "are", "that",
  "this", "from", "has", "have", "had", "not", "can", "will", "do",
  "does", "did", "its", "my", "your", "we", "our", "i", "me", "you",
  "he", "she", "they", "them", "which", "what", "when", "where", "how",
  "all", "each", "any", "no", "so", "if", "up", "out", "about", "into",
  "than", "then", "also", "just", "more", "some", "very", "need",
]);

// Synonym groups — any word expands to all its synonyms during search
const SYNONYM_GROUPS = [
  ["translate", "translation", "translator", "translating", "localization", "multilingual"],
  ["voice", "audio", "speech", "spoken", "tts", "transcription"],
  ["image", "vision", "visual", "photo", "picture", "object-detection"],
  ["embed", "embedding", "embeddings", "vector", "vectors"],
  ["sentiment", "opinion", "feeling", "emotion"],
  ["detect", "detection", "detecting", "recognize", "recognition"],
  ["generate", "generation", "generating", "generative"],
  ["model", "inference", "llm", "completion"],
  ["fast", "fastest", "quick", "low-latency", "speed"],
  ["cheap", "cheapest", "affordable", "budget", "inexpensive"],
];

const SYNONYM_MAP = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    SYNONYM_MAP.set(word, group);
  }
}

function expandWithSynonyms(tokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    const synonyms = SYNONYM_MAP.get(token);
    if (synonyms) {
      for (const s of synonyms) expanded.add(s);
    }
  }
  return [...expanded];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t));
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFIER (Rule-based + optional LLM)
// ─────────────────────────────────────────────────────────────

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

async function classifyIntent(rawQuery: string): Promise<ClassifiedIntent> {
  const normalized = rawQuery.trim().replace(/\s+/g, " ").replace(/[^\w\s$.,\-/]/g, "").toLowerCase();

  // Try LLM classification if API key is available
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      return await classifyWithLlm(rawQuery, normalized, apiKey);
    } catch (err) {
      console.warn("[Search] LLM classification failed, using rules:", err);
    }
  }

  return classifyWithRules(rawQuery, normalized);
}

async function classifyWithLlm(
  rawQuery: string,
  normalized: string,
  apiKey: string
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

Available listing types: REST APIs, GraphQL APIs, WebSocket streams, Datasets, Model Inference endpoints, and Composite services.
Categories: nlp, vision, audio, translation, summarization, code-generation, embeddings, search, recommendation, sentiment-analysis, and more.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: rawQuery }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0]?.text || "{}";
  const clean = text.replace(/```json\s*|```\s*/g, "").trim();
  const parsed = JSON.parse(clean);

  return {
    category: parsed.category || "UNKNOWN",
    confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
    normalizedQuery: normalized,
    secondaryCategory: parsed.secondaryCategory || undefined,
    entities: {
      listingType: parsed.entities?.listingType || undefined,
      categories: Array.isArray(parsed.entities?.categories) ? parsed.entities.categories : [],
      capabilities: Array.isArray(parsed.entities?.capabilities) ? parsed.entities.capabilities : [],
      maxPriceUsdc: typeof parsed.entities?.maxPriceUsdc === "number" ? parsed.entities.maxPriceUsdc : undefined,
      minQuality: typeof parsed.entities?.minQuality === "number" ? parsed.entities.minQuality : undefined,
      maxLatencyMs: typeof parsed.entities?.maxLatencyMs === "number" ? parsed.entities.maxLatencyMs : undefined,
      minCapacityRpm: typeof parsed.entities?.minCapacityRpm === "number" ? parsed.entities.minCapacityRpm : undefined,
      providerName: parsed.entities?.providerName || undefined,
      tags: Array.isArray(parsed.entities?.tags) ? parsed.entities.tags : [],
      sortPreference: parsed.entities?.sortPreference || undefined,
    },
  };
}

function classifyWithRules(rawQuery: string, normalized: string): ClassifiedIntent {
  const lower = normalized.toLowerCase();
  const entities = extractEntities(lower);

  const scores = new Map<string, number>();

  if (matchesAny(lower, ["cheap", "cheapest", "price", "pricing", "cost", "afford", "budget", "under $", "less than", "lowest price"])) {
    scores.set("PRICE_COMPARISON", 0.8);
  }
  if (matchesAny(lower, ["support", "feature", "capability", "can it", "does it", "function calling", "streaming", "batch", "real-time"])) {
    scores.set("CAPABILITY_SEARCH", (scores.get("CAPABILITY_SEARCH") || 0) + 0.7);
  }
  if (matchesAny(lower, ["model", "inference", "gpt", "claude", "llama", "llm", "generate", "predict", "completion"])) {
    scores.set("MODEL_INFERENCE", (scores.get("MODEL_INFERENCE") || 0) + 0.75);
  }
  if (matchesAny(lower, ["dataset", "data set", "training data", "download data", "csv", "parquet", "corpus"])) {
    scores.set("DATA_PROCUREMENT", (scores.get("DATA_PROCUREMENT") || 0) + 0.8);
  }
  if (matchesAny(lower, ["api", "endpoint", "rest", "graphql", "websocket", "integrate", "connect", "access"])) {
    scores.set("API_ACCESS", (scores.get("API_ACCESS") || 0) + 0.6);
  }
  if (matchesAny(lower, ["recommend", "suggest", "best", "top", "which should", "ideal", "perfect for"])) {
    scores.set("RECOMMENDATION", (scores.get("RECOMMENDATION") || 0) + 0.65);
  }

  let bestCategory = "UNKNOWN";
  let bestScore = 0;
  let secondCategory: string | undefined;

  for (const [category, score] of scores) {
    if (score > bestScore) {
      secondCategory = bestCategory !== "UNKNOWN" ? bestCategory : undefined;
      bestCategory = category;
      bestScore = score;
    }
  }

  if (bestScore < 0.3 && lower.length > 5) {
    bestCategory = "API_ACCESS";
    bestScore = 0.3;
  }

  return {
    category: bestCategory,
    confidence: Math.min(1, bestScore),
    normalizedQuery: normalized,
    secondaryCategory: secondCategory,
    entities,
  };
}

function extractEntities(lower: string): ExtractedEntities {
  const entities: ExtractedEntities = { categories: [], capabilities: [], tags: [] };

  const priceMatch = lower.match(/(?:under|below|less than|max|at most|cheaper than)\s*\$?([\d.]+)/);
  if (priceMatch) entities.maxPriceUsdc = parseFloat(priceMatch[1]);

  const latencyMatch = lower.match(/(?:under|below|less than|within|max)\s*(\d+)\s*ms/);
  if (latencyMatch) entities.maxLatencyMs = parseInt(latencyMatch[1], 10);

  if (matchesAny(lower, ["dataset", "data set", "training data"])) entities.listingType = "DATASET";
  else if (matchesAny(lower, ["graphql"])) entities.listingType = "GRAPHQL_API";
  else if (matchesAny(lower, ["websocket", "real-time stream"])) entities.listingType = "WEBSOCKET";
  else if (matchesAny(lower, ["model", "inference", "llm", "gpt", "completion"])) entities.listingType = "MODEL_INFERENCE";
  else if (matchesAny(lower, ["api", "rest", "endpoint"])) entities.listingType = "REST_API";

  const categoryMap: Record<string, string> = {
    nlp: "nlp", "natural language": "nlp", text: "nlp",
    vision: "vision", image: "vision", "computer vision": "vision",
    translation: "translation", translate: "translation", translator: "translation",
    language: "translation", multilingual: "translation", localization: "translation",
    embedding: "embeddings", embeddings: "embeddings",
    sentiment: "sentiment-analysis", "sentiment analysis": "sentiment-analysis",
    "code generation": "code-generation", coding: "code-generation",
    search: "search", audio: "audio", speech: "audio", voice: "audio",
    "text-to-speech": "audio", tts: "audio", transcription: "audio",
    "object detection": "object-detection", detection: "object-detection",
  };

  for (const [keyword, category] of Object.entries(categoryMap)) {
    if (lower.includes(keyword) && !entities.categories.includes(category)) {
      entities.categories.push(category);
    }
  }

  const capabilityMap: Record<string, string> = {
    "function calling": "function-calling", streaming: "streaming",
    batch: "batch-processing", "fine-tuning": "fine-tuning",
    json: "json-output", multilingual: "multilingual",
  };

  for (const [keyword, capability] of Object.entries(capabilityMap)) {
    if (lower.includes(keyword) && !entities.capabilities.includes(capability)) {
      entities.capabilities.push(capability);
    }
  }

  if (matchesAny(lower, ["cheapest", "lowest price", "most affordable"])) entities.sortPreference = "PRICE_LOW";
  else if (matchesAny(lower, ["best quality", "highest rated"])) entities.sortPreference = "QUALITY";
  else if (matchesAny(lower, ["most popular", "trending"])) entities.sortPreference = "POPULARITY";
  else if (matchesAny(lower, ["fastest", "lowest latency"])) entities.sortPreference = "LATENCY";

  return entities;
}

// ─────────────────────────────────────────────────────────────
// LISTING LOADER
// ─────────────────────────────────────────────────────────────

async function loadListings(): Promise<IndexedListing[]> {
  const dbListings = await prisma.listing.findMany({
    where: { status: "ACTIVE" },
    include: {
      category: true,
      provider: { select: { displayName: true } },
      qualitySnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
    },
  });

  return dbListings.map((l) => {
    const quality = l.qualitySnapshots[0];
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      description: l.description,
      listingType: l.listingType,
      categorySlug: l.category.slug,
      tags: l.tags,
      currentPriceUsdc: Number(l.currentPriceUsdc),
      floorPriceUsdc: Number(l.floorPriceUsdc),
      capacityPerMinute: l.capacityPerMinute,
      totalCalls: Number(l.totalCalls),
      avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 200,
      qualityScore: quality ? Number(quality.compositeScore) / 100 : 0.5,
      uptimePercent: quality ? Number(quality.uptimePercent) : 99,
      status: l.status,
      providerName: l.provider.displayName,
      providerId: l.providerId,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// RANKING ENGINE
// ─────────────────────────────────────────────────────────────

function buildInvertedIndex(listings: IndexedListing[]) {
  const index = new Map<string, { listingId: string; frequency: number }[]>();
  const categoryIndex = new Map<string, Set<string>>();
  const tagIndex = new Map<string, Set<string>>();

  for (const listing of listings) {
    // Text index
    const tokens = tokenize(`${listing.name} ${listing.description} ${listing.tags.join(" ")} ${listing.providerName}`);
    const freqs = new Map<string, number>();
    for (const t of tokens) freqs.set(t, (freqs.get(t) || 0) + 1);
    const maxFreq = Math.max(...freqs.values(), 1);
    for (const [term, freq] of freqs) {
      if (!index.has(term)) index.set(term, []);
      index.get(term)!.push({ listingId: listing.id, frequency: freq / maxFreq });
    }

    // Category index
    if (!categoryIndex.has(listing.categorySlug)) categoryIndex.set(listing.categorySlug, new Set());
    categoryIndex.get(listing.categorySlug)!.add(listing.id);

    // Tag index
    for (const tag of listing.tags) {
      const t = tag.toLowerCase();
      if (!tagIndex.has(t)) tagIndex.set(t, new Set());
      tagIndex.get(t)!.add(listing.id);
    }
  }

  return { index, categoryIndex, tagIndex, totalDocs: listings.length };
}

function textSearch(query: string, invertedIndex: Map<string, { listingId: string; frequency: number }[]>, totalDocs: number): Map<string, number> {
  const tokens = expandWithSynonyms(tokenize(query));
  const scores = new Map<string, number>();
  if (tokens.length === 0 || totalDocs === 0) return scores;

  for (const token of tokens) {
    const entries = invertedIndex.get(token);
    if (!entries) continue;
    const idf = Math.log(totalDocs / entries.length);
    for (const entry of entries) {
      scores.set(entry.listingId, (scores.get(entry.listingId) || 0) + entry.frequency * idf);
    }
  }

  const maxScore = Math.max(...scores.values(), 0.001);
  for (const [id, score] of scores) scores.set(id, score / maxScore);
  return scores;
}

function categorySearch(slugs: string[], categoryIndex: Map<string, Set<string>>): Map<string, number> {
  const scores = new Map<string, number>();
  if (slugs.length === 0) return scores;
  for (const slug of slugs) {
    const ids = categoryIndex.get(slug);
    if (!ids) continue;
    for (const id of ids) scores.set(id, (scores.get(id) || 0) + 1);
  }
  for (const [id, count] of scores) scores.set(id, count / slugs.length);
  return scores;
}

function tagSearch(tags: string[], tagIndex: Map<string, Set<string>>): Map<string, number> {
  const scores = new Map<string, number>();
  if (tags.length === 0) return scores;
  for (const tag of tags) {
    const ids = tagIndex.get(tag.toLowerCase());
    if (!ids) continue;
    for (const id of ids) scores.set(id, (scores.get(id) || 0) + 1);
  }
  for (const [id, count] of scores) scores.set(id, count / tags.length);
  return scores;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rankListings(listings: IndexedListing[], intent: ClassifiedIntent): RankedMatch[] {
  if (listings.length === 0) return [];

  const { index: invertedIdx, categoryIndex: catIdx, tagIndex: tIdx, totalDocs } = buildInvertedIndex(listings);
  const textScores = textSearch(intent.normalizedQuery, invertedIdx, totalDocs);
  const catScores = categorySearch(intent.entities.categories, catIdx);
  const tScores = tagSearch(intent.entities.tags, tIdx);

  const maxCalls = Math.max(...listings.map((l) => l.totalCalls), 1);
  const maxLatency = Math.max(...listings.map((l) => l.avgLatencyMs), 1);
  const prices = listings.map((l) => l.currentPriceUsdc);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const weights = INTENT_WEIGHTS[intent.category] || DEFAULT_WEIGHTS;
  const results: RankedMatch[] = [];

  for (const listing of listings) {
    // Hard filters
    if (intent.entities.listingType && listing.listingType !== intent.entities.listingType) continue;
    if (intent.entities.minCapacityRpm && listing.capacityPerMinute < intent.entities.minCapacityRpm) continue;
    if (intent.entities.minQuality && listing.qualityScore < intent.entities.minQuality) continue;
    if (intent.entities.providerName) {
      const pn = listing.providerName.toLowerCase();
      const qn = intent.entities.providerName.toLowerCase();
      if (!pn.includes(qn) && !qn.includes(pn)) continue;
    }

    // Score breakdown
    const textRelevance = clamp01(
      (textScores.get(listing.id) || 0) * 0.7 + (tScores.get(listing.id) || 0) * 0.3
    );
    const categoryMatch = catScores.get(listing.id) || 0;

    let priceScore: number;
    if (intent.entities.maxPriceUsdc !== undefined) {
      if (listing.currentPriceUsdc <= intent.entities.maxPriceUsdc) {
        priceScore = 1 - (listing.currentPriceUsdc / intent.entities.maxPriceUsdc) * 0.5;
      } else {
        priceScore = Math.max(0, 1 - listing.currentPriceUsdc / intent.entities.maxPriceUsdc);
      }
    } else {
      const range = maxPrice - minPrice;
      priceScore = range > 0 ? 1 - (listing.currentPriceUsdc - minPrice) / range : 0.5;
    }

    const qualityScore = listing.qualityScore;
    const popularityScore = maxCalls > 0 ? Math.log(1 + listing.totalCalls) / Math.log(1 + maxCalls) : 0;

    let latencyScore: number;
    if (intent.entities.maxLatencyMs !== undefined) {
      latencyScore = listing.avgLatencyMs <= intent.entities.maxLatencyMs
        ? 1 - (listing.avgLatencyMs / intent.entities.maxLatencyMs) * 0.5
        : Math.max(0, 1 - listing.avgLatencyMs / intent.entities.maxLatencyMs);
    } else {
      latencyScore = maxLatency > 0 ? 1 - listing.avgLatencyMs / maxLatency : 0.5;
    }

    let capabilityMatch = 0.5;
    if (intent.entities.capabilities.length > 0) {
      const listingTags = new Set(listing.tags.map((t) => t.toLowerCase()));
      const matched = intent.entities.capabilities.filter((c) => listingTags.has(c.toLowerCase()));
      capabilityMatch = matched.length / intent.entities.capabilities.length;
    }

    const breakdown: ScoreBreakdown = {
      textRelevance: clamp01(textRelevance),
      categoryMatch: clamp01(categoryMatch),
      priceScore: clamp01(priceScore),
      qualityScore: clamp01(qualityScore),
      popularityScore: clamp01(popularityScore),
      latencyScore: clamp01(latencyScore),
      capabilityMatch: clamp01(capabilityMatch),
    };

    const compositeScore = clamp01(
      breakdown.textRelevance * weights.textRelevance +
      breakdown.categoryMatch * weights.categoryMatch +
      breakdown.priceScore * weights.priceScore +
      breakdown.qualityScore * weights.qualityScore +
      breakdown.popularityScore * weights.popularityScore +
      breakdown.latencyScore * weights.latencyScore +
      breakdown.capabilityMatch * weights.capabilityMatch
    );

    // Match reasons
    const reasons: string[] = [];
    if (breakdown.textRelevance > 0.5) reasons.push("Strong text relevance to your query");
    if (breakdown.categoryMatch > 0.5) reasons.push(`Matches category: ${listing.categorySlug}`);
    if (breakdown.priceScore > 0.7 && intent.entities.maxPriceUsdc) reasons.push(`Within budget at $${listing.currentPriceUsdc.toFixed(6)}/call`);
    if (breakdown.qualityScore > 0.8) reasons.push(`High quality score: ${(listing.qualityScore * 100).toFixed(0)}%`);
    if (breakdown.popularityScore > 0.7) reasons.push(`Popular: ${listing.totalCalls.toLocaleString()} total calls`);
    if (breakdown.latencyScore > 0.8) reasons.push(`Fast: ${listing.avgLatencyMs}ms average latency`);
    if (breakdown.capabilityMatch > 0.7 && intent.entities.capabilities.length > 0) reasons.push("Matches required capabilities");
    if (listing.uptimePercent > 99.5) reasons.push(`${listing.uptimePercent.toFixed(1)}% uptime`);
    if (reasons.length === 0) reasons.push("Matches general search criteria");

    results.push({ listing, score: compositeScore, scoreBreakdown: breakdown, matchReasons: reasons });
  }

  results.sort((a, b) => b.score - a.score);

  // Sort override
  if (intent.entities.sortPreference) {
    switch (intent.entities.sortPreference) {
      case "PRICE_LOW": results.sort((a, b) => a.listing.currentPriceUsdc - b.listing.currentPriceUsdc); break;
      case "PRICE_HIGH": results.sort((a, b) => b.listing.currentPriceUsdc - a.listing.currentPriceUsdc); break;
      case "QUALITY": results.sort((a, b) => b.listing.qualityScore - a.listing.qualityScore); break;
      case "POPULARITY": results.sort((a, b) => b.listing.totalCalls - a.listing.totalCalls); break;
      case "LATENCY": results.sort((a, b) => a.listing.avgLatencyMs - b.listing.avgLatencyMs); break;
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// SUGGESTION GENERATOR
// ─────────────────────────────────────────────────────────────

function generateSuggestions(intent: ClassifiedIntent, matches: RankedMatch[], totalEvaluated: number): string[] {
  const suggestions: string[] = [];

  if (matches.length === 0 && totalEvaluated === 0) {
    suggestions.push("No listings found. The marketplace may be loading — try again shortly.");
    return suggestions;
  }
  if (matches.length === 0) {
    suggestions.push("No strong matches found for your query.");
    if (intent.entities.maxPriceUsdc) suggestions.push(`Try increasing your budget above $${intent.entities.maxPriceUsdc.toFixed(4)}/call.`);
    if (intent.entities.capabilities.length > 0) suggestions.push(`Relax capability requirements: ${intent.entities.capabilities.join(", ")}.`);
    if (intent.entities.listingType) suggestions.push("Try removing the listing type filter for broader results.");
    return suggestions;
  }
  if (matches[0].score < 0.4) suggestions.push("Matches are approximate. Try being more specific in your query.");
  if (matches.length === 1) suggestions.push("Only one match found. Try broadening your search for alternatives.");
  if (intent.confidence < 0.5) suggestions.push("Your query was ambiguous. Try specifying the type of service you need (API, dataset, model).");

  return suggestions;
}

// ─────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  const body = await req.json();
  const { query } = body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const queryId = randomUUID();

  // 1. Classify intent
  const intent = await classifyIntent(query);

  // 2. Load active listings
  const listings = await loadListings();

  // 3. Rank
  const allMatches = rankListings(listings, intent);
  const filteredMatches = allMatches.filter((m) => m.score >= 0.15);
  const topMatches = filteredMatches.slice(0, 10);

  // 4. Suggestions
  const suggestions = generateSuggestions(intent, topMatches, allMatches.length);

  const routeTimeMs = Math.round(performance.now() - startTime);

  // 5. Log query (fire-and-forget)
  const buyer = await prisma.user.findFirst({ where: { roles: { has: "BUYER" } } });
  if (buyer) {
    prisma.queryLog.create({
      data: {
        buyerId: buyer.id,
        rawQuery: query,
        normalizedQuery: intent.normalizedQuery,
        intentClassified: intent.category,
        matchedListingId: topMatches[0]?.listing.id || null,
        confidenceScore: intent.confidence,
        alternativeIds: topMatches.slice(1, 6).map((m) => m.listing.id),
        routeTimeMs,
      },
    }).catch((err: unknown) => console.error("[Search] Log error:", err));
  }

  // 6. Transform response to match frontend RouteResult type
  return NextResponse.json({
    queryId,
    rawQuery: query,
    intent: {
      category: intent.category,
      confidence: intent.confidence,
      entities: intent.entities,
    },
    matches: topMatches.map((m) => ({
      listing: {
        id: m.listing.id,
        slug: m.listing.slug,
        name: m.listing.name,
        description: m.listing.description,
        listingType: m.listing.listingType,
        status: m.listing.status,
        categorySlug: m.listing.categorySlug,
        providerName: m.listing.providerName,
        providerId: m.listing.providerId,
        baseUrl: "",
        floorPriceUsdc: m.listing.floorPriceUsdc,
        currentPriceUsdc: m.listing.currentPriceUsdc,
        ceilingPriceUsdc: null,
        capacityPerMinute: m.listing.capacityPerMinute,
        isUnique: false,
        tags: m.listing.tags,
        totalCalls: m.listing.totalCalls,
        totalRevenue: 0,
        avgRating: 0,
        ratingCount: 0,
        qualityScore: m.listing.qualityScore,
        avgLatencyMs: m.listing.avgLatencyMs,
        uptimePercent: m.listing.uptimePercent,
        publishedAt: null,
        createdAt: "",
      },
      score: m.score,
      scoreBreakdown: m.scoreBreakdown,
      matchReasons: m.matchReasons,
    })),
    totalEvaluated: allMatches.length,
    routeTimeMs,
    suggestions,
  });
}
