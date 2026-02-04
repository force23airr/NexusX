import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = 20;

  // Demo: fetch first provider
  const profile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!profile) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize, hasMore: false });
  }

  const where: any = { providerId: profile.userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: true,
        qualitySnapshots: {
          orderBy: { computedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  const listings = items.map((l) => {
    const quality = l.qualitySnapshots[0];
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      description: l.description,
      listingType: l.listingType,
      status: l.status,
      categorySlug: l.category.slug,
      providerName: "",
      providerId: l.providerId,
      baseUrl: l.baseUrl,
      floorPriceUsdc: Number(l.floorPriceUsdc),
      currentPriceUsdc: Number(l.currentPriceUsdc),
      ceilingPriceUsdc: l.ceilingPriceUsdc ? Number(l.ceilingPriceUsdc) : null,
      capacityPerMinute: l.capacityPerMinute,
      isUnique: l.isUnique,
      tags: l.tags,
      totalCalls: Number(l.totalCalls),
      totalRevenue: Number(l.totalRevenue),
      avgRating: Number(l.avgRating),
      ratingCount: l.ratingCount,
      qualityScore: quality ? Number(quality.compositeScore) : 0,
      avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 0,
      uptimePercent: quality ? Number(quality.uptimePercent) : 100,
      publishedAt: l.publishedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    };
  });

  return NextResponse.json({
    items: listings,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}
