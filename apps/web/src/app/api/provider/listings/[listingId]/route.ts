import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────
// GET /api/provider/listings/[listingId]
// Returns full listing detail for the provider dashboard.
// ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;

  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      category: true,
      qualitySnapshots: {
        orderBy: { computedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (listing.providerId !== result.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const quality = listing.qualitySnapshots[0];
  const videoUrl = listing.schemaSpec && typeof listing.schemaSpec === "object"
    ? (listing.schemaSpec as Record<string, unknown>).videoUrl as string | undefined
    : undefined;

  return NextResponse.json({
    id: listing.id,
    slug: listing.slug,
    name: listing.name,
    description: listing.description,
    listingType: listing.listingType,
    status: listing.status,
    categorySlug: listing.category.slug,
    categoryName: listing.category.name,
    categoryId: listing.categoryId,
    providerName: "",
    providerId: listing.providerId,
    baseUrl: listing.baseUrl,
    healthCheckUrl: listing.healthCheckUrl,
    docsUrl: listing.docsUrl,
    sandboxUrl: listing.sandboxUrl,
    authType: listing.authType,
    videoUrl: videoUrl ?? null,
    floorPriceUsdc: Number(listing.floorPriceUsdc),
    currentPriceUsdc: Number(listing.currentPriceUsdc),
    ceilingPriceUsdc: listing.ceilingPriceUsdc ? Number(listing.ceilingPriceUsdc) : null,
    capacityPerMinute: listing.capacityPerMinute,
    isUnique: listing.isUnique,
    tags: listing.tags,
    sampleRequest: listing.sampleRequest,
    sampleResponse: listing.sampleResponse,
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
    priceHistory: [],
  });
}

// ─────────────────────────────────────────────────────────────
// PUT /api/provider/listings/[listingId]
// Update listing fields. Only allowed when DRAFT or PAUSED.
// ─────────────────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;
  const body = await req.json();

  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (listing.providerId !== result.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (listing.status !== "DRAFT" && listing.status !== "PAUSED") {
    return NextResponse.json(
      { error: `Cannot edit listing in ${listing.status} status. Pause it first.` },
      { status: 409 }
    );
  }

  // Build update data from allowed fields
  const data: Record<string, unknown> = {};
  const allowedFields = [
    "name", "description", "baseUrl", "healthCheckUrl", "docsUrl",
    "sandboxUrl", "authType", "capacityPerMinute", "isUnique", "tags",
    "sampleRequest", "sampleResponse",
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  // Handle pricing fields separately (need Decimal conversion)
  if (body.floorPriceUsdc !== undefined) {
    data.floorPriceUsdc = body.floorPriceUsdc;
  }
  if (body.ceilingPriceUsdc !== undefined) {
    data.ceilingPriceUsdc = body.ceilingPriceUsdc;
  }
  if (body.categoryId !== undefined) {
    data.categoryId = body.categoryId;
  }

  // Handle videoUrl → schemaSpec
  if (body.videoUrl !== undefined) {
    data.schemaSpec = body.videoUrl ? { videoUrl: body.videoUrl } : undefined;
  }

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data,
    include: { category: true },
  });

  return NextResponse.json({
    id: updated.id,
    slug: updated.slug,
    name: updated.name,
    status: updated.status,
  });
}
