import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalListings,
    aggregates,
    activeBuyerGroups,
    avgQuality,
    topListingsRaw,
    categoriesRaw,
    categoryListingCounts,
  ] = await Promise.all([
    // 1. Total active listings
    prisma.listing.count({ where: { status: "ACTIVE" } }),

    // 2. Aggregate calls + revenue
    prisma.listing.aggregate({
      where: { status: "ACTIVE" },
      _sum: { totalCalls: true, totalRevenue: true },
    }),

    // 3. Distinct buyers with CONFIRMED txns in last 30d
    prisma.transaction.groupBy({
      by: ["buyerId"],
      where: { status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
    }),

    // 4. Avg quality score
    prisma.qualitySnapshot.aggregate({
      _avg: { compositeScore: true },
    }),

    // 5. Top 5 listings by totalCalls
    prisma.listing.findMany({
      where: { status: "ACTIVE" },
      orderBy: { totalCalls: "desc" },
      take: 5,
      include: {
        category: true,
        provider: { select: { displayName: true } },
        qualitySnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    }),

    // 6. Categories with top 4 listings each
    prisma.category.findMany({
      where: { isActive: true },
      include: {
        listings: {
          where: { status: "ACTIVE" },
          orderBy: { totalCalls: "desc" },
          take: 4,
          include: {
            provider: { select: { displayName: true } },
            qualitySnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
          },
        },
      },
    }),

    // 7. Accurate listing counts per category
    prisma.listing.groupBy({
      by: ["categoryId"],
      where: { status: "ACTIVE" },
      _count: true,
    }),
  ]);

  // ─── Map top 5 listings ───
  const topListings = topListingsRaw.map((l) => {
    const q = l.qualitySnapshots[0];
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      providerName: l.provider.displayName,
      listingType: l.listingType,
      categorySlug: l.category.slug,
      totalCalls: Number(l.totalCalls),
      totalRevenue: Number(l.totalRevenue),
      currentPriceUsdc: Number(l.currentPriceUsdc),
      qualityScore: q ? Number(q.compositeScore) : 0,
      avgLatencyMs: q ? Number(q.medianLatencyMs) : 0,
      uptimePercent: q ? Number(q.uptimePercent) : 100,
      tags: l.tags,
    };
  });

  // ─── Build category count map ───
  const countMap = new Map(
    categoryListingCounts.map((c) => [c.categoryId, c._count])
  );

  // ─── Map categories, sort by aggregate calls, take top 5 ───
  const topCategories = categoriesRaw
    .map((cat) => {
      const listings = cat.listings.map((l) => {
        const q = l.qualitySnapshots[0];
        return {
          id: l.id,
          slug: l.slug,
          name: l.name,
          providerName: l.provider.displayName,
          listingType: l.listingType,
          categorySlug: cat.slug,
          totalCalls: Number(l.totalCalls),
          totalRevenue: Number(l.totalRevenue),
          currentPriceUsdc: Number(l.currentPriceUsdc),
          qualityScore: q ? Number(q.compositeScore) : 0,
          avgLatencyMs: q ? Number(q.medianLatencyMs) : 0,
          uptimePercent: q ? Number(q.uptimePercent) : 100,
          tags: l.tags,
        };
      });
      return {
        slug: cat.slug,
        name: cat.name,
        listingCount: countMap.get(cat.id) ?? 0,
        totalCalls: listings.reduce((sum, l) => sum + l.totalCalls, 0),
        totalRevenue: listings.reduce((sum, l) => sum + l.totalRevenue, 0),
        listings,
      };
    })
    .filter((c) => c.listings.length > 0)
    .sort((a, b) => b.totalCalls - a.totalCalls)
    .slice(0, 5);

  return NextResponse.json({
    totalListings,
    totalCalls: Number(aggregates._sum.totalCalls ?? 0),
    totalRevenueUsdc: Number(aggregates._sum.totalRevenue ?? 0),
    activeBuyers: activeBuyerGroups.length,
    avgQualityScore: Number(avgQuality._avg.compositeScore ?? 0),
    topListings,
    topCategories,
  });
}
