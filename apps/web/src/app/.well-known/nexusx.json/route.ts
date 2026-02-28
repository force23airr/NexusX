import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { NexusXManifest, NexusXManifestCapability } from "@nexusx/database";

/**
 * GET /.well-known/nexusx.json
 *
 * Serves the NexusX marketplace manifest — "robots.txt for agents".
 * Dynamically generated from all ACTIVE listings.
 * No auth required. Cached for 5 minutes.
 */
export async function GET() {
  const listings = await prisma.listing.findMany({
    where: { status: "ACTIVE" },
    include: { category: true },
  });

  const capabilities: NexusXManifestCapability[] = listings.map((l) => ({
    name: l.name,
    description: l.description,
    listingType: l.listingType,
    intents: l.intents,
    category: l.category.slug,
    baseUrl: l.baseUrl,
    healthCheckUrl: l.healthCheckUrl ?? undefined,
    docsUrl: l.docsUrl ?? undefined,
    authType: l.authType,
    pricing: {
      floorUsdc: Number(l.floorPriceUsdc),
      ceilingUsdc: l.ceilingPriceUsdc ? Number(l.ceilingPriceUsdc) : undefined,
      currency: "USDC" as const,
    },
    capacityPerMinute: l.capacityPerMinute,
    tags: l.tags,
    sampleRequest: l.sampleRequest as Record<string, unknown> | undefined,
    sampleResponse: l.sampleResponse as Record<string, unknown> | undefined,
  }));

  const manifest: NexusXManifest = {
    version: "1.0",
    provider: {
      name: "NexusX Marketplace",
      website: "https://nexusx.ai",
      contact: "support@nexusx.ai",
    },
    capabilities,
  };

  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
