import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const listingId = searchParams.get("listingId");

  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const where: Record<string, unknown> = {
    listing: { providerId: result.user.id },
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
