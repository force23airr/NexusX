import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const listingId = searchParams.get("listingId");

  // Get the demo provider's listings
  const providerProfile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });

  if (!providerProfile) {
    return NextResponse.json({ items: [] });
  }

  const where: Record<string, unknown> = {
    listing: { providerId: providerProfile.userId },
  };
  if (listingId) {
    where.listingId = listingId;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      priceUsdc: true,
      platformFeeUsdc: true,
      providerAmountUsdc: true,
      responseTimeMs: true,
      httpStatus: true,
      billingMode: true,
      createdAt: true,
      listing: {
        select: {
          id: true,
          slug: true,
          name: true,
          listingType: true,
        },
      },
      buyer: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  const items = transactions.map((t) => ({
    id: t.id,
    status: t.status,
    priceUsdc: Number(t.priceUsdc),
    providerAmountUsdc: Number(t.providerAmountUsdc),
    latencyMs: t.responseTimeMs ?? 0,
    httpStatus: t.httpStatus ?? 200,
    billingMode: t.billingMode,
    createdAt: t.createdAt.toISOString(),
    listingId: t.listing.id,
    listingSlug: t.listing.slug,
    listingName: t.listing.name,
    listingType: t.listing.listingType,
    buyerId: t.buyer.id,
    buyerName: t.buyer.displayName,
  }));

  return NextResponse.json({ items });
}
