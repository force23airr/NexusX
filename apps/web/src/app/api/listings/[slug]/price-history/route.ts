import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "7d";

  const listing = await prisma.listing.findUnique({
    where: { slug },
    select: { id: true, currentPriceUsdc: true },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const now = new Date();
  const periodMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };

  const cutoff = new Date(now.getTime() - (periodMs[period] || periodMs["7d"]));

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      listingId: listing.id,
      computedAt: { gte: cutoff },
    },
    orderBy: { computedAt: "asc" },
  });

  const points = snapshots.map((s) => ({
    timestamp: s.computedAt.toISOString(),
    price: Number(s.currentPrice),
    changePercent: Number(s.priceChangePct),
  }));

  const prices = points.map((p) => p.price);
  const high = prices.length > 0 ? Math.max(...prices) : Number(listing.currentPriceUsdc);
  const low = prices.length > 0 ? Math.min(...prices) : Number(listing.currentPriceUsdc);

  return NextResponse.json({
    points,
    high,
    low,
    current: Number(listing.currentPriceUsdc),
  });
}
