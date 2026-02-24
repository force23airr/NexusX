// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Listing Discovery Service
// apps/mcp-server/src/services/discovery.ts
//
// Queries listings from the database for MCP tool registration.
// Extends the loadActiveListingsForIndex pattern from
// packages/database/src/helpers.ts with extra fields for MCP.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";
import type { DiscoveredListing, CategoryNode, WalletInfo } from "../types";

export class DiscoveryService {
  constructor(private prisma: PrismaClient) {}

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
        description: cat.description,
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
}
