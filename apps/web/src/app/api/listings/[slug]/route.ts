import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const listing = await prisma.listing.findUnique({
    where: { slug },
    include: {
      category: true,
      provider: { select: { id: true, displayName: true, avatarUrl: true } },
      qualitySnapshots: {
        orderBy: { computedAt: "desc" },
        take: 1,
      },
      priceSnapshots: {
        orderBy: { computedAt: "desc" },
        take: 30,
      },
    },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const quality = listing.qualitySnapshots[0];
  const schemaSpec = (listing.schemaSpec as Record<string, unknown>) || {};

  const priceHistory = listing.priceSnapshots
    .map((ps) => ({
      timestamp: ps.computedAt.toISOString(),
      price: Number(ps.currentPrice),
      changePercent: Number(ps.priceChangePct),
    }))
    .reverse();

  const result = {
    id: listing.id,
    slug: listing.slug,
    name: listing.name,
    description: listing.description,
    listingType: listing.listingType,
    status: listing.status,
    categorySlug: listing.category.slug,
    providerName: listing.provider.displayName,
    providerId: listing.providerId,
    baseUrl: listing.baseUrl,
    docsUrl: listing.docsUrl,
    sandboxUrl: listing.sandboxUrl,
    authType: listing.authType,
    floorPriceUsdc: Number(listing.floorPriceUsdc),
    currentPriceUsdc: Number(listing.currentPriceUsdc),
    ceilingPriceUsdc: listing.ceilingPriceUsdc
      ? Number(listing.ceilingPriceUsdc)
      : null,
    capacityPerMinute: listing.capacityPerMinute,
    isUnique: listing.isUnique,
    tags: listing.tags,
    totalCalls: Number(listing.totalCalls),
    totalRevenue: Number(listing.totalRevenue),
    avgRating: Number(listing.avgRating),
    ratingCount: listing.ratingCount,
    qualityScore: quality ? Number(quality.compositeScore) : 0,
    avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 0,
    uptimePercent: quality ? Number(quality.uptimePercent) : 100,
    errorRatePercent: quality ? Number(quality.errorRatePercent) : 0,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    videoUrl: (schemaSpec.videoUrl as string) || null,
    sampleRequest: listing.sampleRequest,
    sampleResponse: listing.sampleResponse,
    priceHistory,
  };

  return NextResponse.json(result);
}
