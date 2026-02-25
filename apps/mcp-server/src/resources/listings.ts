// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Listing Resources
// apps/mcp-server/src/resources/listings.ts
//
// Resources:
//   nexusx://listings        — all active listings
//   nexusx://listings/{slug} — single listing detail
// ═══════════════════════════════════════════════════════════════

import type { DiscoveryService } from "../services/discovery";
import type { GatewayClient } from "../services/gateway-client";

export function createListingsResourceHandler(discovery: DiscoveryService) {
  return async (): Promise<string> => {
    const listings = await discovery.loadListings();
    const summary = listings.map((l) => ({
      slug: l.slug,
      name: l.name,
      description: l.description.slice(0, 200),
      category: l.categorySlug,
      type: l.listingType,
      price: `$${l.currentPriceUsdc.toFixed(6)} USDC`,
      quality: `${Math.round(l.qualityScore * 100)}%`,
      uptime: `${l.uptimePercent.toFixed(1)}%`,
      latency: `${l.avgLatencyMs}ms`,
      tags: l.tags,
      provider: l.providerName,
    }));
    return JSON.stringify(summary, null, 2);
  };
}

export function createListingDetailResourceHandler(
  discovery: DiscoveryService,
  gateway: GatewayClient,
) {
  return async (slug: string): Promise<string> => {
    const listing = await discovery.getListing(slug);
    if (!listing) {
      return JSON.stringify({ error: "Listing not found", slug });
    }

    // Fetch pricing info and live reliability from gateway (parallel)
    const [pricing, reliabilityScore] = await Promise.all([
      gateway.getPricing(slug),
      gateway.getReliability(slug),
    ]);

    // Determine reliability status
    let reliability: Record<string, unknown> | undefined;
    if (reliabilityScore) {
      const status =
        reliabilityScore.errorRate < 0.02 && reliabilityScore.uptimePct > 0.98 ? "healthy" :
        reliabilityScore.errorRate < 0.05 && reliabilityScore.uptimePct > 0.95 ? "degraded" :
        "unreliable";

      reliability = {
        errorRate: `${(reliabilityScore.errorRate * 100).toFixed(1)}%`,
        p50Latency: `${reliabilityScore.p50LatencyMs}ms`,
        p95Latency: `${reliabilityScore.p95LatencyMs}ms`,
        p99Latency: `${reliabilityScore.p99LatencyMs}ms`,
        uptime: `${(reliabilityScore.uptimePct * 100).toFixed(1)}%`,
        callCount: reliabilityScore.callCount,
        qualityScore: `${reliabilityScore.qualityScore}/100`,
        status,
      };
    }

    const detail = {
      slug: listing.slug,
      name: listing.name,
      description: listing.description,
      type: listing.listingType,
      category: listing.categorySlug,
      provider: listing.providerName,
      pricing: {
        current: `$${listing.currentPriceUsdc.toFixed(6)} USDC/call`,
        floor: `$${listing.floorPriceUsdc.toFixed(6)} USDC`,
        ceiling: listing.ceilingPriceUsdc
          ? `$${listing.ceilingPriceUsdc.toFixed(6)} USDC`
          : "uncapped",
        ...(pricing
          ? {
              platformFee: `$${pricing.platformFee.toFixed(6)} USDC`,
              providerReceives: `$${pricing.providerAmount.toFixed(6)} USDC`,
              feeRate: `${(pricing.feeRate * 100).toFixed(1)}%`,
            }
          : {}),
      },
      quality: {
        score: `${Math.round(listing.qualityScore * 100)}%`,
        uptime: `${listing.uptimePercent.toFixed(1)}%`,
        avgLatency: `${listing.avgLatencyMs}ms`,
      },
      ...(reliability ? { reliability } : {}),
      capacity: `${listing.capacityPerMinute} requests/min`,
      tags: listing.tags,
      docs: listing.docsUrl,
      sampleRequest: listing.sampleRequest,
      sampleResponse: listing.sampleResponse,
    };

    return JSON.stringify(detail, null, 2);
  };
}
