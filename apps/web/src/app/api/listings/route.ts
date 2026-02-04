import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const type = searchParams.get("type");
  const sectorsParam = searchParams.get("sectors");
  const sort = searchParams.get("sort") || "popular";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

  const where: any = { status: "ACTIVE" };
  if (category) where.category = { slug: category };
  if (type) where.listingType = type;
  if (sectorsParam) {
    const sectorTags = sectorsParam.split(",").map((s) => `sector:${s}`);
    where.tags = { hasSome: sectorTags };
  }

  const orderBy: any =
    sort === "price_asc"
      ? { currentPriceUsdc: "asc" }
      : sort === "price_desc"
        ? { currentPriceUsdc: "desc" }
        : sort === "newest"
          ? { createdAt: "desc" }
          : { totalCalls: "desc" };

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: true,
        provider: { select: { id: true, displayName: true, avatarUrl: true } },
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
      providerName: l.provider.displayName,
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
      publishedAt: l.createdAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
    };
  });

  return NextResponse.json({
    items: listings,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
