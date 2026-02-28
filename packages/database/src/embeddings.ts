// ═══════════════════════════════════════════════════════════════
// NexusX — Semantic Embedding Service
// packages/database/src/embeddings.ts
//
// Central module for vector-based semantic search. All consumers
// (MCP server, web search, future channels) share this backend
// so ranking behaviour never drifts between surfaces.
//
// Capabilities:
//   - Generate 512-dim embeddings via OpenAI text-embedding-3-small
//   - pgvector cosine similarity search via parameterised Prisma.sql
//   - Simulated reranker with priority-mode weight shifting
//   - Optional Redis query-embedding cache (5-min TTL)
//   - Category diversity guardrails
// ═══════════════════════════════════════════════════════════════

import { createHash } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────

export interface EmbeddingConfig {
  openaiApiKey: string;
  model?: string;       // default: "text-embedding-3-small"
  dimensions?: number;  // default: 512
}

export type PriorityMode = "frugal" | "balanced" | "mission_critical";

export type FallbackReason =
  | "no_api_key"
  | "no_embedding"
  | "embed_error"
  | "vector_query_error";

export interface SemanticSearchResult {
  listingId: string;
  slug: string;
  name: string;
  listingType: string;
  description: string;
  categorySlug: string;
  tags: string[];
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  ceilingPriceUsdc: number | null;
  capacityPerMinute: number;
  qualityScore: number;
  avgLatencyMs: number;
  uptimePercent: number;
  totalCalls: number;
  providerName: string;
  similarity: number;
  compositeScore: number;
  fallbackReason?: FallbackReason;
}

export interface SearchListingsOptions {
  query: string;
  limit?: number;
  similarityThreshold?: number;
  priorityMode?: PriorityMode;
  budgetMaxUsdc?: number;
}

export interface EmbedResult {
  embedded: number;
  skipped: number;
  errors: number;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 512;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 10;
const PGVECTOR_TOP_N = 50;
const MAX_PER_CATEGORY = 3;
const DB_VECTOR_DIMENSIONS = 512;
const CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX = "nexusx:qembed:";
const CACHE_SCHEMA_VERSION = "v1";

// Priority mode weight tables
const RERANK_WEIGHTS: Record<PriorityMode, {
  similarity: number;
  price: number;
  quality: number;
  nameTagOverlap: number;
  popularity: number;
}> = {
  frugal:           { similarity: 0.30, price: 0.35, quality: 0.10, nameTagOverlap: 0.15, popularity: 0.10 },
  balanced:         { similarity: 0.40, price: 0.15, quality: 0.20, nameTagOverlap: 0.15, popularity: 0.10 },
  mission_critical: { similarity: 0.50, price: 0.05, quality: 0.30, nameTagOverlap: 0.10, popularity: 0.05 },
};

// ─── Embedding Text Builder ──────────────────────────────────

/**
 * Build the rich text blob used for embedding a listing.
 * Includes name, category, description, tags, and any synthetic queries.
 */
export function buildEmbeddingText(listing: {
  name: string;
  description: string;
  categorySlug?: string;
  tags?: string[];
  intents?: string[];
  syntheticQueries?: string[];
}): string {
  const parts: string[] = [
    listing.name,
    listing.categorySlug ?? "",
    listing.description,
    ...(listing.tags ?? []),
    ...(listing.intents ?? []),
    ...(listing.syntheticQueries ?? []),
  ];
  return parts.filter(Boolean).join(" ").slice(0, 8000);
}

// ─── OpenAI Embedding Generation ─────────────────────────────

/**
 * Call OpenAI to generate a single embedding vector.
 * Uses Matryoshka truncation to get 512 dims from text-embedding-3-small.
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const model = config.model ?? DEFAULT_MODEL;
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      input: text,
      model,
      dimensions,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embedding API error ${response.status}: ${body}`);
  }

  const data: unknown = await response.json();
  const embedding = extractEmbedding(data);
  if (embedding.length !== dimensions) {
    throw new Error(
      `OpenAI embedding dimension mismatch. Expected ${dimensions}, got ${embedding.length}.`,
    );
  }
  return embedding;
}

// ─── Embed a Single Listing ──────────────────────────────────

/**
 * Embed one listing: build text → generate vector → store via raw SQL.
 * Skips if listing already has an embedding (unless force=true).
 */
export async function embedListing(
  prisma: PrismaClient,
  listingId: string,
  config: EmbeddingConfig,
  options?: { force?: boolean },
): Promise<boolean> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      name: true,
      description: true,
      tags: true,
      intents: true,
      embeddedAt: true,
      syntheticQueries: true,
      category: { select: { slug: true } },
    },
  });

  if (!listing) return false;
  if (listing.embeddedAt && !options?.force) return false;

  const text = buildEmbeddingText({
    name: listing.name,
    description: listing.description,
    categorySlug: listing.category.slug,
    tags: listing.tags,
    intents: listing.intents,
    syntheticQueries: listing.syntheticQueries,
  });

  const vector = await generateEmbedding(text, config);
  const vectorStr = `[${vector.join(",")}]`;
  const model = config.model ?? DEFAULT_MODEL;

  await prisma.$executeRaw(Prisma.sql`
    UPDATE listings
    SET embedding = ${vectorStr}::vector,
        embedding_model = ${model},
        embedded_at = NOW()
    WHERE id = ${listingId}::uuid
  `);

  return true;
}

// ─── Batch Embed All Listings ────────────────────────────────

/**
 * Embed all ACTIVE listings that don't have embeddings yet.
 * Processes in batches of 10 with a delay between batches for rate limits.
 */
export async function embedAllListings(
  prisma: PrismaClient,
  config: EmbeddingConfig,
  options?: { force?: boolean; batchSize?: number; delayMs?: number },
): Promise<EmbedResult> {
  const force = options?.force ?? false;
  const batchSize = options?.batchSize ?? 10;
  const delayMs = options?.delayMs ?? 100;

  const whereClause = force
    ? { status: "ACTIVE" as const }
    : { status: "ACTIVE" as const, embeddedAt: null };

  const listings = await prisma.listing.findMany({
    where: whereClause,
    select: { id: true },
  });

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (listing) => {
        try {
          const didEmbed = await embedListing(prisma, listing.id, config, { force });
          if (didEmbed) embedded++;
          else skipped++;
        } catch (err) {
          errors++;
          console.error(`[Embeddings] Failed to embed listing ${listing.id}:`, err);
        }
      }),
    );

    // Rate limit delay between batches
    if (i + batchSize < listings.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { embedded, skipped, errors };
}

// ─── pgvector Cosine Similarity Search ───────────────────────

interface VectorSearchRow {
  listingId: string;
  slug: string;
  name: string;
  listingType: string;
  description: string;
  categorySlug: string;
  tags: string[];
  currentPriceUsdc: number;
  floorPriceUsdc: number;
  ceilingPriceUsdc: number | null;
  capacityPerMinute: number;
  qualityScore: number;
  avgLatencyMs: number;
  uptimePercent: number;
  totalCalls: bigint;
  providerName: string;
  similarity: number;
}

/**
 * Raw pgvector cosine similarity search.
 * Returns top-N listings ordered by similarity descending.
 */
async function vectorSearch(
  prisma: PrismaClient,
  queryEmbedding: number[],
  options: {
    limit?: number;
    similarityThreshold?: number;
    budgetMaxUsdc?: number;
  },
): Promise<VectorSearchRow[]> {
  if (queryEmbedding.length !== DB_VECTOR_DIMENSIONS) {
    throw new Error(
      `Invalid query embedding length ${queryEmbedding.length}. Expected ${DB_VECTOR_DIMENSIONS}.`,
    );
  }

  const limit = options.limit ?? PGVECTOR_TOP_N;
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  if (options.budgetMaxUsdc !== undefined) {
    return prisma.$queryRaw<VectorSearchRow[]>(Prisma.sql`
      SELECT
        l.id                                              AS "listingId",
        l.slug,
        l.name,
        l.listing_type::text                              AS "listingType",
        l.description,
        c.slug                                            AS "categorySlug",
        l.tags,
        l.current_price_usdc::float                       AS "currentPriceUsdc",
        l.floor_price_usdc::float                         AS "floorPriceUsdc",
        l.ceiling_price_usdc::float                       AS "ceilingPriceUsdc",
        l.capacity_per_minute                             AS "capacityPerMinute",
        COALESCE(qs.composite_score::float / 100.0, 0.5)  AS "qualityScore",
        COALESCE(qs.median_latency_ms::float, 200)        AS "avgLatencyMs",
        COALESCE(qs.uptime_percent::float, 99.0)          AS "uptimePercent",
        l.total_calls                                     AS "totalCalls",
        u.display_name                                    AS "providerName",
        1 - (l.embedding <=> ${vectorStr}::vector)         AS similarity
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.provider_id
      LEFT JOIN LATERAL (
        SELECT composite_score, median_latency_ms, uptime_percent
        FROM quality_snapshots
        WHERE listing_id = l.id
        ORDER BY computed_at DESC
        LIMIT 1
      ) qs ON true
      WHERE l.status = 'ACTIVE'
        AND l.embedding IS NOT NULL
        AND 1 - (l.embedding <=> ${vectorStr}::vector) >= ${threshold}
        AND l.current_price_usdc <= ${options.budgetMaxUsdc}
      ORDER BY l.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);
  }

  return prisma.$queryRaw<VectorSearchRow[]>(Prisma.sql`
    SELECT
      l.id                                              AS "listingId",
      l.slug,
      l.name,
      l.listing_type::text                              AS "listingType",
      l.description,
      c.slug                                            AS "categorySlug",
      l.tags,
      l.current_price_usdc::float                       AS "currentPriceUsdc",
      l.floor_price_usdc::float                         AS "floorPriceUsdc",
      l.ceiling_price_usdc::float                       AS "ceilingPriceUsdc",
      l.capacity_per_minute                             AS "capacityPerMinute",
      COALESCE(qs.composite_score::float / 100.0, 0.5)  AS "qualityScore",
      COALESCE(qs.median_latency_ms::float, 200)        AS "avgLatencyMs",
      COALESCE(qs.uptime_percent::float, 99.0)          AS "uptimePercent",
      l.total_calls                                     AS "totalCalls",
      u.display_name                                    AS "providerName",
      1 - (l.embedding <=> ${vectorStr}::vector)         AS similarity
    FROM listings l
    JOIN categories c ON c.id = l.category_id
    JOIN users u ON u.id = l.provider_id
    LEFT JOIN LATERAL (
      SELECT composite_score, median_latency_ms, uptime_percent
      FROM quality_snapshots
      WHERE listing_id = l.id
      ORDER BY computed_at DESC
      LIMIT 1
    ) qs ON true
    WHERE l.status = 'ACTIVE'
      AND l.embedding IS NOT NULL
      AND 1 - (l.embedding <=> ${vectorStr}::vector) >= ${threshold}
    ORDER BY l.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);
}

// ─── Category Diversity Filter ───────────────────────────────

/**
 * Apply category diversity — cap at MAX_PER_CATEGORY results per category
 * unless fewer than 5 categories are represented.
 */
function applyDiversityFilter(rows: VectorSearchRow[]): VectorSearchRow[] {
  const categoryCounts = new Map<string, number>();
  for (const r of rows) {
    categoryCounts.set(r.categorySlug, (categoryCounts.get(r.categorySlug) ?? 0) + 1);
  }

  // If fewer than 5 categories, skip diversity filtering
  if (categoryCounts.size < 5) return rows;

  const perCategory = new Map<string, number>();
  return rows.filter((r) => {
    const count = perCategory.get(r.categorySlug) ?? 0;
    if (count >= MAX_PER_CATEGORY) return false;
    perCategory.set(r.categorySlug, count + 1);
    return true;
  });
}

// ─── Simulated Reranker ──────────────────────────────────────

/**
 * Rescore results using multi-signal reranking.
 * Combines semantic similarity, price, quality, name/tag overlap, and popularity.
 */
function rerank(
  rows: VectorSearchRow[],
  query: string,
  priorityMode: PriorityMode,
): SemanticSearchResult[] {
  if (rows.length === 0) return [];

  const weights = RERANK_WEIGHTS[priorityMode];
  const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));

  // Normalisation helpers
  const prices = rows.map((r) => r.currentPriceUsdc);
  const maxPrice = Math.max(...prices, 0.000001);
  const maxCalls = Math.max(...rows.map((r) => Number(r.totalCalls)), 1);

  return rows.map((row) => {
    // Semantic similarity (already 0-1 from pgvector)
    const simScore = row.similarity;

    // Price score: lower is better, normalised 0-1
    const priceScore = 1 - row.currentPriceUsdc / maxPrice;

    // Quality score (already 0-1)
    const qualScore = row.qualityScore;

    // Name/tag keyword overlap
    const nameTokens = new Set(row.name.toLowerCase().split(/\s+/));
    const tagTokens = new Set(row.tags.map((t) => t.toLowerCase()));
    let overlapCount = 0;
    for (const qt of queryTokens) {
      if (nameTokens.has(qt)) overlapCount++;
      if (tagTokens.has(qt)) overlapCount++;
    }
    const nameTagOverlap = queryTokens.size > 0
      ? Math.min(1, overlapCount / queryTokens.size)
      : 0;

    // Popularity: log-scaled, capped
    const popScore = Math.log(1 + Number(row.totalCalls)) / Math.log(1 + maxCalls);

    // Composite
    const compositeScore =
      simScore * weights.similarity +
      priceScore * weights.price +
      qualScore * weights.quality +
      nameTagOverlap * weights.nameTagOverlap +
      popScore * weights.popularity;

    return {
      listingId: row.listingId,
      slug: row.slug,
      name: row.name,
      listingType: row.listingType,
      description: row.description,
      categorySlug: row.categorySlug,
      tags: row.tags,
      currentPriceUsdc: row.currentPriceUsdc,
      floorPriceUsdc: row.floorPriceUsdc,
      ceilingPriceUsdc: row.ceilingPriceUsdc,
      capacityPerMinute: row.capacityPerMinute,
      qualityScore: row.qualityScore,
      avgLatencyMs: row.avgLatencyMs,
      uptimePercent: row.uptimePercent,
      totalCalls: Number(row.totalCalls),
      providerName: row.providerName,
      similarity: row.similarity,
      compositeScore,
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);
}

// ─── Query Embedding Cache (Redis, optional) ─────────────────

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Get or create a query embedding, using Redis cache if available.
 */
async function getCachedQueryEmbedding(
  query: string,
  config: EmbeddingConfig,
  redis?: RedisLike | null,
): Promise<number[]> {
  const normalised = query.toLowerCase().trim();
  const model = config.model ?? DEFAULT_MODEL;
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  const queryHash = createHash("sha256").update(normalised).digest("hex");
  const cacheKey = `${CACHE_PREFIX}${CACHE_SCHEMA_VERSION}:${model}:${dimensions}:${queryHash}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // Cache miss or Redis error — proceed to API
    }

    const embedding = await generateEmbedding(normalised, config);

    // Store in cache (fire-and-forget)
    redis.set(cacheKey, JSON.stringify(embedding), "EX", CACHE_TTL_SECONDS).catch(() => {});

    return embedding;
  }

  return generateEmbedding(normalised, config);
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

function extractEmbedding(raw: unknown): number[] {
  if (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as OpenAIEmbeddingResponse).data) &&
    (raw as OpenAIEmbeddingResponse).data.length > 0 &&
    Array.isArray((raw as OpenAIEmbeddingResponse).data[0]?.embedding)
  ) {
    return (raw as OpenAIEmbeddingResponse).data[0].embedding;
  }

  throw new Error("OpenAI embedding API returned unexpected payload shape.");
}

// ─── Full Search Pipeline ────────────────────────────────────

/**
 * Full semantic search pipeline:
 *   1. Cache check → embed query
 *   2. pgvector top-50
 *   3. Diversity filter
 *   4. Rerank with priority mode
 *   5. Return top-N
 *
 * This is the shared entry point for MCP server, web search, and any future channel.
 */
export async function searchListings(
  prisma: PrismaClient,
  query: string,
  config: EmbeddingConfig,
  options?: SearchListingsOptions & { redis?: RedisLike | null },
): Promise<SemanticSearchResult[]> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const threshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const priorityMode = options?.priorityMode ?? "balanced";

  // 1. Get query embedding (cached if Redis available)
  const queryEmbedding = await getCachedQueryEmbedding(query, config, options?.redis);

  // 2. pgvector search — fetch top 50
  const rawResults = await vectorSearch(prisma, queryEmbedding, {
    limit: PGVECTOR_TOP_N,
    similarityThreshold: threshold,
    budgetMaxUsdc: options?.budgetMaxUsdc,
  });

  // 3. Category diversity filter
  const diverse = applyDiversityFilter(rawResults);

  // 4. Rerank
  const reranked = rerank(diverse, query, priorityMode);

  // 5. Return top-N
  return reranked.slice(0, limit);
}

// ─── Embedding Existence Check ───────────────────────────────

/**
 * Check whether any listings have embeddings.
 * Used by consumers to decide whether to attempt semantic search.
 */
export async function hasEmbeddings(prisma: PrismaClient): Promise<boolean> {
  const result = await prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
    SELECT COUNT(*) as count FROM listings
    WHERE embedding IS NOT NULL AND status = 'ACTIVE'
  `);
  return Number(result[0].count) > 0;
}
