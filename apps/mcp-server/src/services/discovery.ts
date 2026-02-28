// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Listing Discovery Service
// apps/mcp-server/src/services/discovery.ts
//
// Queries listings from the database for MCP tool registration.
// Extends the loadActiveListingsForIndex pattern from
// packages/database/src/helpers.ts with extra fields for MCP.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";
import {
  searchListings,
  hasEmbeddings,
  type EmbeddingConfig,
  type SemanticSearchResult,
  type PriorityMode,
  type FallbackReason,
} from "@nexusx/database";
import type { DiscoveredListing, CategoryNode, WalletInfo } from "../types";

export interface DiscoverySearchResult {
  listings: DiscoveredListing[];
  source: "semantic" | "keyword";
  fallbackReason?: FallbackReason;
}

export class DiscoveryService {
  private static readonly EMBEDDINGS_CHECK_TTL_MS = 30_000;
  private embeddingConfig: EmbeddingConfig | null = null;
  private embeddingsAvailable: boolean | null = null;
  private embeddingsCheckedAtMs: number | null = null;

  constructor(private prisma: PrismaClient) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      this.embeddingConfig = { openaiApiKey: openaiKey };
    }
  }

  /**
   * Load all active listings with MCP-relevant metadata.
   */
  async loadListings(): Promise<DiscoveredListing[]> {
    const listings = await this.prisma.listing.findMany({
      where: { status: "ACTIVE" },
      include: {
        category: true,
        provider: true,
        qualitySnapshots: {
          orderBy: { computedAt: "desc" },
          take: 1,
        },
      },
    });

    return listings.map((l) => {
      const quality = l.qualitySnapshots[0];

      return {
        id: l.id,
        slug: l.slug,
        name: l.name,
        description: l.description,
        listingType: l.listingType,
        categorySlug: l.category.slug,
        tags: l.tags,
        intents: l.intents ?? [],
        currentPriceUsdc: Number(l.currentPriceUsdc),
        floorPriceUsdc: Number(l.floorPriceUsdc),
        ceilingPriceUsdc: l.ceilingPriceUsdc ? Number(l.ceilingPriceUsdc) : null,
        capacityPerMinute: l.capacityPerMinute,
        qualityScore: quality ? Number(quality.compositeScore) / 100 : 0.5,
        avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 0,
        uptimePercent: quality ? Number(quality.uptimePercent) : 99.0,
        sampleRequest: l.sampleRequest as Record<string, unknown> | null,
        sampleResponse: l.sampleResponse as Record<string, unknown> | null,
        schemaSpec: l.schemaSpec as Record<string, unknown> | null,
        docsUrl: l.docsUrl,
        providerName: l.provider.displayName,
      };
    });
  }

  /**
   * Load a single listing by slug.
   */
  async getListing(slug: string): Promise<DiscoveredListing | null> {
    const l = await this.prisma.listing.findUnique({
      where: { slug },
      include: {
        category: true,
        provider: true,
        qualitySnapshots: {
          orderBy: { computedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!l || l.status !== "ACTIVE") return null;

    const quality = l.qualitySnapshots[0];

    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      description: l.description,
      listingType: l.listingType,
      categorySlug: l.category.slug,
      tags: l.tags,
      intents: l.intents ?? [],
      currentPriceUsdc: Number(l.currentPriceUsdc),
      floorPriceUsdc: Number(l.floorPriceUsdc),
      ceilingPriceUsdc: l.ceilingPriceUsdc ? Number(l.ceilingPriceUsdc) : null,
      capacityPerMinute: l.capacityPerMinute,
      qualityScore: quality ? Number(quality.compositeScore) / 100 : 0.5,
      avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 0,
      uptimePercent: quality ? Number(quality.uptimePercent) : 99.0,
      sampleRequest: l.sampleRequest as Record<string, unknown> | null,
      sampleResponse: l.sampleResponse as Record<string, unknown> | null,
      schemaSpec: l.schemaSpec as Record<string, unknown> | null,
      docsUrl: l.docsUrl,
      providerName: l.provider.displayName,
    };
  }

  /**
   * Load the category tree.
   */
  async getCategories(): Promise<CategoryNode[]> {
    const categories = await this.prisma.category.findMany({
      include: {
        _count: { select: { listings: { where: { status: "ACTIVE" } } } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    // Build parent→children map
    const nodeMap = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const cat of categories) {
      nodeMap.set(cat.id, {
        id: cat.id,
        slug: cat.slug,
        name: cat.name,
        description: cat.description ?? "",
        children: [],
        listingCount: cat._count.listings,
      });
    }

    for (const cat of categories) {
      const node = nodeMap.get(cat.id)!;
      if (cat.parentId && nodeMap.has(cat.parentId)) {
        nodeMap.get(cat.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Look up wallet info for the user associated with an API key prefix.
   */
  async getUserWallet(apiKeyPrefix: string): Promise<WalletInfo | null> {
    const key = await this.prisma.apiKey.findFirst({
      where: { keyPrefix: apiKeyPrefix, status: "ACTIVE" },
      include: { user: { include: { wallet: true } } },
    });

    if (!key?.user.wallet) return null;

    return {
      address: key.user.wallet.address,
      balanceUsdc: Number(key.user.wallet.balanceUsdc),
      escrowUsdc: Number(key.user.wallet.escrowUsdc),
    };
  }

  // ─── Semantic Search with Instrumented Fallback ─────────

  /**
   * Search listings using pgvector semantic similarity.
   * Falls back to keyword matching if embeddings are unavailable.
   * Every fallback is instrumented with a reason code.
   */
  async semanticSearch(query: string, options?: {
    limit?: number;
    budgetMaxUsdc?: number;
    priorityMode?: PriorityMode;
  }): Promise<DiscoverySearchResult> {
    // Check 1: API key
    if (!this.embeddingConfig) {
      return this.keywordFallback(query, options, "no_api_key");
    }

    // Check 2: Embeddings exist in DB (cached check)
    try {
      const now = Date.now();
      const shouldRefresh =
        this.embeddingsAvailable === null ||
        this.embeddingsCheckedAtMs === null ||
        now - this.embeddingsCheckedAtMs > DiscoveryService.EMBEDDINGS_CHECK_TTL_MS;

      if (shouldRefresh) {
        this.embeddingsAvailable = await hasEmbeddings(this.prisma);
        this.embeddingsCheckedAtMs = now;
      }
      if (!this.embeddingsAvailable) {
        return this.keywordFallback(query, options, "no_embedding");
      }
    } catch {
      return this.keywordFallback(query, options, "no_embedding");
    }

    // Attempt semantic search
    try {
      const results = await searchListings(this.prisma, query, this.embeddingConfig, {
        query,
        limit: options?.limit ?? 10,
        budgetMaxUsdc: options?.budgetMaxUsdc,
        priorityMode: options?.priorityMode ?? "balanced",
      });

      if (results.length === 0) {
        // No semantic match is a valid outcome; do not force keyword fallback.
        return { listings: [], source: "semantic" };
      }

      return {
        listings: results.map((r) => this.semanticToDiscovered(r)),
        source: "semantic",
      };
    } catch (err) {
      const reason: FallbackReason =
        err instanceof Error && err.message.includes("OpenAI")
          ? "embed_error"
          : "vector_query_error";
      return this.keywordFallback(query, options, reason, err);
    }
  }

  /**
   * Keyword-based listing search (original matching logic).
   * Used as fallback when semantic search is unavailable.
   */
  private async keywordSearch(query: string, options?: {
    limit?: number;
    budgetMaxUsdc?: number;
  }): Promise<DiscoveredListing[]> {
    const q = query.toLowerCase();
    const budgetMax = options?.budgetMaxUsdc ?? null;
    const limit = options?.limit ?? 10;

    const listings = await this.loadListings();

    return listings
      .map((l) => {
        let score = 0;
        const searchText = `${l.name} ${l.description} ${l.tags.join(" ")} ${l.categorySlug}`.toLowerCase();

        const queryWords = q.split(/\s+/);
        for (const word of queryWords) {
          if (searchText.includes(word)) score += 10;
          if (l.name.toLowerCase().includes(word)) score += 20;
          if (l.tags.some((t) => t.toLowerCase().includes(word))) score += 15;
        }

        score += l.qualityScore * 5;

        if (budgetMax !== null && l.currentPriceUsdc > budgetMax) {
          score = -1;
        }

        return { listing: l, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.listing);
  }

  private async keywordFallback(
    query: string,
    options: { limit?: number; budgetMaxUsdc?: number } | undefined,
    reason: FallbackReason,
    err?: unknown,
  ): Promise<DiscoverySearchResult> {
    if (err) {
      console.error(`[Discovery] Semantic search failed, reason: ${reason}`, err);
    } else {
      console.error(`[Discovery] Semantic search unavailable, reason: ${reason}`);
    }

    return {
      listings: await this.keywordSearch(query, options),
      source: "keyword",
      fallbackReason: reason,
    };
  }

  /**
   * Convert a SemanticSearchResult to a DiscoveredListing.
   */
  private semanticToDiscovered(r: SemanticSearchResult): DiscoveredListing {
    return {
      id: r.listingId,
      slug: r.slug,
      name: r.name,
      description: r.description,
      listingType: r.listingType,
      categorySlug: r.categorySlug,
      tags: r.tags,
      intents: [],
      currentPriceUsdc: r.currentPriceUsdc,
      floorPriceUsdc: r.floorPriceUsdc,
      ceilingPriceUsdc: r.ceilingPriceUsdc,
      capacityPerMinute: r.capacityPerMinute,
      qualityScore: r.qualityScore,
      avgLatencyMs: r.avgLatencyMs,
      uptimePercent: r.uptimePercent,
      sampleRequest: null,
      sampleResponse: null,
      schemaSpec: null,
      docsUrl: null,
      providerName: r.providerName,
    };
  }
}
