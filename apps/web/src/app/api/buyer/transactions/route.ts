import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listingId");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

  // Demo: fetch first buyer user
  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
  });
  if (!buyer) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize, hasMore: false });
  }

  const where: any = { buyerId: buyer.id };
  if (listingId) where.listingId = listingId;

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        listing: { select: { name: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  const transactions = items.map((t) => ({
    id: t.id,
    listingId: t.listingId,
    listingName: t.listing.name,
    buyerId: t.buyerId,
    status: t.status,
    priceUsdc: Number(t.priceUsdc),
    platformFeeUsdc: Number(t.platformFeeUsdc),
    providerAmountUsdc: Number(t.providerAmountUsdc),
    responseTimeMs: t.responseTimeMs ?? 0,
    createdAt: t.createdAt.toISOString(),
  }));

  return NextResponse.json({
    items: transactions,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}
