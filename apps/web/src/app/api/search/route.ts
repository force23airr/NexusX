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
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getUserFromApiKey } from "@/lib/apiKeyAuth";
import { randomUUID } from "crypto";
import {
  buildOperationSearchText,
  buildMetadataWhereClause,
  buildDiscoverableListingWhere,
  combineListingWhere,
  computeOperationSearchMatch,
  computeRegionAffinity,
  recordUnmetDemand,
  searchListings,
  type EmbeddingConfig,
  type MetadataFilters,
  type OperationSearchMatch,
  type PriorityMode,
  type SemanticSearchResult,
} from "@nexusx/database";


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

interface SearchRequestBody {
  query: string;
  metadataFilters?: unknown;
  priorityMode?: unknown;
  limit?: unknown;
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
  trustScore: number;
  trustState: "trusted" | "degraded" | "high_risk" | "unproven";
  uptimePercent: number;
  status: string;
  providerName: string;
  providerId: string;
  availabilityRegions: string[];
  domainMetadata?: Prisma.JsonValue | null;
  schemaSpec?: Prisma.JsonValue | null;
  operationSearchText?: string;
}

interface ScoreBreakdown {
  textRelevance: number;
  categoryMatch: number;
  priceScore: number;
  qualityScore: number;
  trustScore: number;
  regionAffinityScore?: number;
  popularityScore: number;
  latencyScore: number;
  capabilityMatch: number;
  operationMatch: number;
}

interface RankedMatch {
  listing: IndexedListing;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  matchReasons: string[];
  matchedOperations: OperationSearchMatch[];
}

const DEFAULT_WEIGHTS = {
  textRelevance: 0.28,
  categoryMatch: 0.18,
  priceScore: 0.12,
  qualityScore: 0.12,
  trustScore: 0.15,
  popularityScore: 0.08,
  latencyScore: 0.05,
  capabilityMatch: 0.02,
  operationMatch: 0.08,
};

const INTENT_WEIGHTS: Record<string, typeof DEFAULT_WEIGHTS> = {
  PRICE_COMPARISON: {
    textRelevance: 0.12, categoryMatch: 0.12, priceScore: 0.35,
    qualityScore: 0.08, trustScore: 0.12, popularityScore: 0.08, latencyScore: 0.05, capabilityMatch: 0.04, operationMatch: 0.10,
  },
  CAPABILITY_SEARCH: {
    textRelevance: 0.18, categoryMatch: 0.14, priceScore: 0.05,
    qualityScore: 0.10, trustScore: 0.14, popularityScore: 0.06, latencyScore: 0.05, capabilityMatch: 0.18, operationMatch: 0.20,
  },
  MODEL_INFERENCE: {
    textRelevance: 0.22, categoryMatch: 0.18, priceScore: 0.08,
    qualityScore: 0.16, trustScore: 0.14, popularityScore: 0.06, latencyScore: 0.08, capabilityMatch: 0.03, operationMatch: 0.05,
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

async function loadListings(metadataFilters?: MetadataFilters): Promise<IndexedListing[]> {
  const where = metadataFilters
    ? combineListingWhere(
        buildDiscoverableListingWhere(),
        buildMetadataWhereClause(metadataFilters),
      )
    : buildDiscoverableListingWhere();
  const dbListings = await prisma.listing.findMany({
    where,
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
      trustScore: quality ? Number(quality.compositeScore) / 100 : 0.82,
      trustState: "unproven",
      uptimePercent: quality ? Number(quality.uptimePercent) : 99,
      status: l.status,
      providerName: l.provider.displayName,
      providerId: l.providerId,
      availabilityRegions: l.availabilityRegions,
      domainMetadata: l.domainMetadata as Prisma.JsonValue | null,
      schemaSpec: l.schemaSpec as Prisma.JsonValue | null,
      operationSearchText: buildOperationSearchText(l.schemaSpec as Prisma.JsonValue | null),
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
    const tokens = tokenize(
      `${listing.name} ${listing.description} ${listing.tags.join(" ")} ${listing.providerName} ${listing.operationSearchText ?? ""}`,
    );
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

function rankListings(
  listings: IndexedListing[],
  intent: ClassifiedIntent,
  metadataFilters?: MetadataFilters,
  semanticScores?: Map<string, number>,
): RankedMatch[] {
  if (listings.length === 0) return [];

  const { index: invertedIdx, categoryIndex: catIdx, tagIndex: tIdx, totalDocs } = buildInvertedIndex(listings);
  // Use semantic scores for text relevance when available, fall back to TF-IDF
  const textScores = semanticScores ?? textSearch(intent.normalizedQuery, invertedIdx, totalDocs);
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
    const trustScore = listing.trustScore;
    const regionAffinity = computeRegionAffinity({
      availabilityRegion: metadataFilters?.availabilityRegion,
      availabilityRegions: listing.availabilityRegions,
      domainMetadata: listing.domainMetadata ?? null,
    });
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

    const operationMatch = computeOperationSearchMatch(
      intent.normalizedQuery,
      listing.schemaSpec ?? null,
    );

    const breakdown: ScoreBreakdown = {
      textRelevance: clamp01(textRelevance),
      categoryMatch: clamp01(categoryMatch),
      priceScore: clamp01(priceScore),
      qualityScore: clamp01(qualityScore),
      trustScore: clamp01(trustScore),
      regionAffinityScore: clamp01(regionAffinity.score),
      popularityScore: clamp01(popularityScore),
      latencyScore: clamp01(latencyScore),
      capabilityMatch: clamp01(capabilityMatch),
      operationMatch: clamp01(operationMatch.score),
    };

    const compositeScore = clamp01(
      breakdown.textRelevance * weights.textRelevance +
      breakdown.categoryMatch * weights.categoryMatch +
      breakdown.priceScore * weights.priceScore +
      breakdown.qualityScore * weights.qualityScore +
      breakdown.trustScore * weights.trustScore +
      (breakdown.regionAffinityScore ?? 0) * 0.05 +
      breakdown.popularityScore * weights.popularityScore +
      breakdown.latencyScore * weights.latencyScore +
      breakdown.capabilityMatch * weights.capabilityMatch +
      breakdown.operationMatch * weights.operationMatch
    );

    // Match reasons
    const reasons: string[] = [];
    if (breakdown.textRelevance > 0.5) reasons.push("Strong text relevance to your query");
    if (breakdown.categoryMatch > 0.5) reasons.push(`Matches category: ${listing.categorySlug}`);
    if (breakdown.priceScore > 0.7 && intent.entities.maxPriceUsdc) reasons.push(`Within budget at $${listing.currentPriceUsdc.toFixed(6)}/call`);
    if (breakdown.qualityScore > 0.8) reasons.push(`High quality score: ${(listing.qualityScore * 100).toFixed(0)}%`);
    if (breakdown.trustScore > 0.85) reasons.push(`Stable execution trust: ${(listing.trustScore * 100).toFixed(0)}%`);
    if ((breakdown.regionAffinityScore ?? 0) >= 0.7 && regionAffinity.reason) reasons.push(regionAffinity.reason);
    if (breakdown.popularityScore > 0.7) reasons.push(`Popular: ${listing.totalCalls.toLocaleString()} total calls`);
    if (breakdown.latencyScore > 0.8) reasons.push(`Fast: ${listing.avgLatencyMs}ms average latency`);
    if (breakdown.capabilityMatch > 0.7 && intent.entities.capabilities.length > 0) reasons.push("Matches required capabilities");
    if (breakdown.operationMatch >= 0.55 && operationMatch.matches[0]) {
      reasons.push(`Supports action: ${operationMatch.matches[0].name}`);
    }
    if (listing.uptimePercent > 99.5) reasons.push(`${listing.uptimePercent.toFixed(1)}% uptime`);
    if (reasons.length === 0) reasons.push("Matches general search criteria");

    results.push({
      listing,
      score: compositeScore,
      scoreBreakdown: breakdown,
      matchReasons: reasons,
      matchedOperations: operationMatch.matches,
    });
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

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sanitizeMetadataFilters(raw: unknown): MetadataFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const candidate = raw as Record<string, unknown>;
  const filters: MetadataFilters = {};
  const availabilityRegion =
    typeof candidate.availabilityRegion === "string" ? candidate.availabilityRegion.trim().toUpperCase() : undefined;

  if (availabilityRegion) filters.availabilityRegion = availabilityRegion;

  const complianceRequired = parseStringArray(candidate.complianceRequired);
  if (complianceRequired) filters.complianceRequired = complianceRequired;

  const capabilityRequired = parseStringArray(candidate.capabilityRequired);
  if (capabilityRequired) filters.capabilityRequired = capabilityRequired;

  const inputModality = parseStringArray(candidate.inputModality);
  if (inputModality) filters.inputModality = inputModality;

  const outputModality = parseStringArray(candidate.outputModality);
  if (outputModality) filters.outputModality = outputModality;

  if (typeof candidate.listingType === "string" && candidate.listingType.trim().length > 0) {
    filters.listingType = candidate.listingType.trim();
  }

  const maxPriceUsdc = parseNumber(candidate.maxPriceUsdc);
  if (maxPriceUsdc !== undefined) filters.maxPriceUsdc = maxPriceUsdc;

  const minCapacityRpm = parseNumber(candidate.minCapacityRpm);
  if (minCapacityRpm !== undefined) filters.minCapacityRpm = minCapacityRpm;

  return filters;
}

function inferAvailabilityRegion(req: NextRequest): string | undefined {
  const candidate =
    req.headers.get("x-nexusx-region") ||
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cf-ipcountry") ||
    req.headers.get("cloudfront-viewer-country");

  if (!candidate) return undefined;
  const normalized = candidate.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function buildMetadataFilters(
  req: NextRequest,
  intent: ClassifiedIntent,
  rawFilters: unknown,
): MetadataFilters {
  const filters = sanitizeMetadataFilters(rawFilters);
  const inferredRegion = inferAvailabilityRegion(req);

  if (!filters.availabilityRegion && inferredRegion) {
    filters.availabilityRegion = inferredRegion;
  }

  if (!filters.listingType && intent.entities.listingType) {
    filters.listingType = intent.entities.listingType;
  }

  if (filters.maxPriceUsdc === undefined && intent.entities.maxPriceUsdc !== undefined) {
    filters.maxPriceUsdc = intent.entities.maxPriceUsdc;
  }

  if (filters.minCapacityRpm === undefined && intent.entities.minCapacityRpm !== undefined) {
    filters.minCapacityRpm = intent.entities.minCapacityRpm;
  }

  return filters;
}

function resolvePriorityMode(value: unknown): PriorityMode {
  return value === "frugal" || value === "balanced" || value === "mission_critical"
    ? value
    : "balanced";
}

function resolveLimit(value: unknown): number {
  const parsed = parseNumber(value);
  if (parsed === undefined) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 25);
}

function buildDemandIntent(intent: ClassifiedIntent): string {
  const parts = [
    ...intent.entities.capabilities,
    ...intent.entities.categories,
    intent.entities.providerName,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return parts.length > 0 ? parts.join(" ") : intent.normalizedQuery;
}

function semanticResultsToMatches(
  results: SemanticSearchResult[],
  intent: ClassifiedIntent,
): RankedMatch[] {
  if (results.length === 0) return [];

  const maxCalls = Math.max(...results.map((result) => result.totalCalls), 1);
  const maxLatency = Math.max(...results.map((result) => result.avgLatencyMs), 1);
  const prices = results.map((result) => result.currentPriceUsdc);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return results.map((result) => {
    const listingTags = new Set(result.tags.map((tag) => tag.toLowerCase()));
    const listingIntents = new Set(result.intents.map((entry) => entry.toLowerCase()));
    const categoryMatch = intent.entities.categories.includes(result.categorySlug) ? 1 : 0;

    let capabilityMatch = 0.5;
    if (intent.entities.capabilities.length > 0) {
      const matched = intent.entities.capabilities.filter((capability) => {
        const normalized = capability.toLowerCase();
        return listingTags.has(normalized) || listingIntents.has(normalized);
      });
      capabilityMatch = matched.length / intent.entities.capabilities.length;
    }

    let priceScore = 0.5;
    if (intent.entities.maxPriceUsdc !== undefined && intent.entities.maxPriceUsdc > 0) {
      priceScore = result.currentPriceUsdc <= intent.entities.maxPriceUsdc
        ? 1 - (result.currentPriceUsdc / intent.entities.maxPriceUsdc) * 0.5
        : Math.max(0, 1 - result.currentPriceUsdc / intent.entities.maxPriceUsdc);
    } else if (maxPrice > minPrice) {
      priceScore = 1 - (result.currentPriceUsdc - minPrice) / (maxPrice - minPrice);
    }

    const latencyScore = intent.entities.maxLatencyMs && intent.entities.maxLatencyMs > 0
      ? result.avgLatencyMs <= intent.entities.maxLatencyMs
        ? 1 - (result.avgLatencyMs / intent.entities.maxLatencyMs) * 0.5
        : Math.max(0, 1 - result.avgLatencyMs / intent.entities.maxLatencyMs)
      : 1 - result.avgLatencyMs / maxLatency;

    const popularityScore =
      maxCalls > 0 ? Math.log(1 + result.totalCalls) / Math.log(1 + maxCalls) : 0;

    const scoreBreakdown: ScoreBreakdown = {
      textRelevance: clamp01(result.similarity),
      categoryMatch: clamp01(categoryMatch),
      priceScore: clamp01(priceScore),
      qualityScore: clamp01(result.qualityScore),
      trustScore: clamp01(result.trustScore),
      regionAffinityScore: clamp01(result.regionAffinityScore ?? 0),
      popularityScore: clamp01(popularityScore),
      latencyScore: clamp01(latencyScore),
      capabilityMatch: clamp01(capabilityMatch),
      operationMatch: clamp01(result.operationMatchScore),
    };

    const matchReasons: string[] = [];
    if (result.similarity >= 0.75) matchReasons.push("Strong semantic match to your query");
    if (categoryMatch > 0) matchReasons.push(`Matches category: ${result.categorySlug}`);
    if (capabilityMatch >= 0.7 && intent.entities.capabilities.length > 0) {
      matchReasons.push("Matches required capabilities");
    }
    if (
      intent.entities.providerName &&
      result.providerName.toLowerCase().includes(intent.entities.providerName.toLowerCase())
    ) {
      matchReasons.push(`Matches provider: ${result.providerName}`);
    }
    if (result.qualityScore >= 0.8) {
      matchReasons.push(`High quality score: ${(result.qualityScore * 100).toFixed(0)}%`);
    }
    if (result.trustScore >= 0.85) {
      matchReasons.push(`Stable execution trust: ${(result.trustScore * 100).toFixed(0)}%`);
    }
    if ((result.regionAffinityScore ?? 0) >= 0.7 && result.regionAffinityReason) {
      matchReasons.push(result.regionAffinityReason);
    }
    if (result.operationMatchScore >= 0.55 && result.matchedOperations[0]) {
      matchReasons.push(`Supports action: ${result.matchedOperations[0].name}`);
    }
    if (result.avgLatencyMs > 0 && scoreBreakdown.latencyScore >= 0.8) {
      matchReasons.push(`Fast: ${result.avgLatencyMs}ms average latency`);
    }
    if (matchReasons.length === 0) {
      matchReasons.push("Matches general search criteria");
    }

    const listing: IndexedListing = {
      id: result.listingId,
      slug: result.slug,
      name: result.name,
      description: result.description,
      listingType: result.listingType,
      categorySlug: result.categorySlug,
      tags: result.tags,
      currentPriceUsdc: result.currentPriceUsdc,
      floorPriceUsdc: result.floorPriceUsdc,
      capacityPerMinute: result.capacityPerMinute,
      totalCalls: result.totalCalls,
      avgLatencyMs: result.avgLatencyMs,
      qualityScore: result.qualityScore,
      trustScore: result.trustScore,
      trustState: result.trustState,
      uptimePercent: result.uptimePercent,
      status: "ACTIVE",
      providerName: result.providerName,
      providerId: result.providerId,
      availabilityRegions: result.availabilityRegions,
      domainMetadata: result.domainMetadata as Prisma.JsonValue | null,
    };

    const score = clamp01(
      scoreBreakdown.textRelevance * 0.55 +
      scoreBreakdown.qualityScore * 0.10 +
      scoreBreakdown.trustScore * 0.15 +
      (scoreBreakdown.regionAffinityScore ?? 0) * 0.05 +
      scoreBreakdown.categoryMatch * 0.10 +
      scoreBreakdown.capabilityMatch * 0.10 +
      scoreBreakdown.operationMatch * 0.15 +
      scoreBreakdown.priceScore * 0.05 +
      scoreBreakdown.latencyScore * 0.05,
    );

    return {
      listing,
      score,
      scoreBreakdown,
      matchReasons,
      matchedOperations: result.matchedOperations,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  const body = await req.json() as SearchRequestBody;
  const query = typeof body.query === "string" ? body.query : "";

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const queryId = randomUUID();
  const limit = resolveLimit(body.limit);
  const priorityMode = resolvePriorityMode(body.priorityMode);

  // 1. Classify intent
  const intent = await classifyIntent(query);
  const metadataFilters = buildMetadataFilters(req, intent, body.metadataFilters);

  // 2. Shared semantic/hybrid search path
  let allMatches: RankedMatch[] = [];
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const embeddingConfig: EmbeddingConfig = { openaiApiKey: openaiKey };
      const semanticResults = await searchListings(prisma, intent.normalizedQuery, embeddingConfig, {
        query: intent.normalizedQuery,
        limit: Math.max(limit * 3, 25),
        similarityThreshold: 0.2,
        priorityMode,
        budgetMaxUsdc: metadataFilters.maxPriceUsdc,
        metadataFilters,
        hybrid: true,
      });
      allMatches = semanticResultsToMatches(semanticResults, intent);
    } catch (err) {
      console.warn("[Search] Shared semantic search failed, falling back to keyword ranking:", err);
    }
  }

  // 3. Fallback path for environments without embeddings or when semantic search yields nothing.
  if (allMatches.length === 0) {
    const listings = await loadListings(metadataFilters);
    allMatches = rankListings(listings, intent, metadataFilters);
  }

  const filteredMatches = allMatches.filter((m) => m.score >= 0.15);
  const topMatches = filteredMatches.slice(0, limit);

  // 4. Suggestions
  const suggestions = generateSuggestions(intent, topMatches, allMatches.length);

  const routeTimeMs = Math.round(performance.now() - startTime);

  // 5. Log query (fire-and-forget)
  const buyer = await getUserFromApiKey(req) ?? await getCurrentUser();
  if (buyer) {
    prisma.queryLog.create({
      data: {
        id: queryId,
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

  const impressionIds = Array.from(new Set(topMatches.map((match) => match.listing.id))).slice(0, limit);
  if (impressionIds.length > 0) {
    prisma.listing.updateMany({
      where: { id: { in: impressionIds } },
      data: { discoveryImpressions: { increment: 1 } },
    }).catch((err: unknown) => console.error("[Search] Impression update error:", err));
  }

  const topScore = topMatches[0]?.score ?? 0;
  if (topMatches.length === 0 || topScore < 0.3) {
    recordUnmetDemand(prisma, query, buildDemandIntent(intent), topScore, topMatches.length)
      .catch((err: unknown) => console.error("[Search] Demand gap tracking error:", err));
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
        trustScore: m.listing.trustScore,
        trustState: m.listing.trustState,
        avgLatencyMs: m.listing.avgLatencyMs,
        uptimePercent: m.listing.uptimePercent,
        publishedAt: null,
        createdAt: "",
      },
      score: m.score,
      scoreBreakdown: m.scoreBreakdown,
      matchReasons: m.matchReasons,
      matchedOperations: m.matchedOperations,
    })),
    totalEvaluated: allMatches.length,
    routeTimeMs,
    suggestions,
  });
}
