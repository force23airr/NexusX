import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "7d";

  // Determine time window
  const now = new Date();
  const periodMs: Record<string, number> = {
    "1h": 3600_000,
    "24h": 86400_000,
    "7d": 604800_000,
    "30d": 2592000_000,
  };
  const windowMs = periodMs[period] || 604800_000;
  const since = new Date(now.getTime() - windowMs);

  // Fetch transactions in window
  const transactions = await prisma.transaction.findMany({
    where: {
      listingId,
      createdAt: { gte: since },
      status: "CONFIRMED",
    },
    select: {
      priceUsdc: true,
      platformFeeUsdc: true,
      providerAmountUsdc: true,
      responseTimeMs: true,
      buyerId: true,
      createdAt: true,
    },
  });

  const totalCalls = transactions.length;
  const totalRevenueUsdc = transactions.reduce((s, t) => s + Number(t.priceUsdc), 0);
  const platformFeesUsdc = transactions.reduce((s, t) => s + Number(t.platformFeeUsdc), 0);
  const netRevenueUsdc = transactions.reduce((s, t) => s + Number(t.providerAmountUsdc), 0);
  const uniqueBuyers = new Set(transactions.map((t) => t.buyerId)).size;
  const avgLatencyMs =
    totalCalls > 0
      ? transactions.reduce((s, t) => s + (t.responseTimeMs ?? 0), 0) / totalCalls
      : 0;

  // Quality snapshot
  const quality = await prisma.qualitySnapshot.findFirst({
    where: { listingId },
    orderBy: { computedAt: "desc" },
  });

  // Demand snapshot
  const demand = await prisma.demandSnapshot.findFirst({
    where: { listingId },
    orderBy: { computedAt: "desc" },
  });

  // Rating
  const ratingAgg = await prisma.rating.aggregate({
    where: { listingId },
    _avg: { score: true },
  });

  // Price history from price snapshots
  const priceSnapshots = await prisma.priceSnapshot.findMany({
    where: { listingId, computedAt: { gte: since } },
    orderBy: { computedAt: "asc" },
    select: { currentPrice: true, computedAt: true },
    take: 30,
  });

  // Build call volume buckets (simplified: group by day)
  const callBuckets = new Map<string, number>();
  for (const t of transactions) {
    const day = t.createdAt.toISOString().slice(0, 10);
    callBuckets.set(day, (callBuckets.get(day) || 0) + 1);
  }

  return NextResponse.json({
    period,
    totalCalls,
    totalRevenueUsdc,
    platformFeesUsdc,
    netRevenueUsdc,
    uniqueBuyers,
    avgLatencyMs: Math.round(avgLatencyMs),
    errorRate: quality ? Number(quality.errorRatePercent) : 0,
    avgRating: ratingAgg._avg.score ?? 0,
    demandScore: demand ? Number(demand.score) / 100 : 0,
    qualityScore: quality ? Number(quality.compositeScore) / 100 : 0,
    priceHistory: priceSnapshots.map((p) => ({
      timestamp: p.computedAt.toISOString(),
      price: Number(p.currentPrice),
    })),
    callVolume: Array.from(callBuckets.entries()).map(([day, calls]) => ({
      timestamp: day,
      calls,
    })),
  });
}
