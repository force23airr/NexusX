import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


async function getDemoBuyer() {
  return prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
    select: { id: true },
  });
}

export async function GET() {
  const buyer = await getDemoBuyer();
  if (!buyer) {
    return NextResponse.json({ error: "No buyer found" }, { status: 404 });
  }

  const items = await prisma.watchlistItem.findMany({
    where: { buyerId: buyer.id },
    include: {
      listing: {
        select: {
          id: true,
          name: true,
          slug: true,
          currentPriceUsdc: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const result = items.map((item) => ({
    id: item.id,
    listingId: item.listingId,
    listingName: item.listing.name,
    listingSlug: item.listing.slug,
    currentPriceUsdc: Number(item.listing.currentPriceUsdc),
    alertOnPriceDrop: item.alertOnPriceDrop,
    alertThreshold: item.alertThreshold ? Number(item.alertThreshold) : null,
    createdAt: item.createdAt.toISOString(),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const buyer = await getDemoBuyer();
  if (!buyer) {
    return NextResponse.json({ error: "No buyer found" }, { status: 404 });
  }

  const body = await req.json();
  const { listingId, alertOnPriceDrop, alertThreshold } = body as {
    listingId: string;
    alertOnPriceDrop?: boolean;
    alertThreshold?: number;
  };

  if (!listingId) {
    return NextResponse.json(
      { error: "listingId is required" },
      { status: 400 }
    );
  }

  // Check listing exists
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true },
  });
  if (!listing) {
    return NextResponse.json(
      { error: "Listing not found" },
      { status: 404 }
    );
  }

  // Upsert watchlist item
  const item = await prisma.watchlistItem.upsert({
    where: {
      buyerId_listingId: { buyerId: buyer.id, listingId },
    },
    create: {
      buyerId: buyer.id,
      listingId,
      alertOnPriceDrop: alertOnPriceDrop ?? false,
      alertThreshold: alertThreshold ?? null,
    },
    update: {
      alertOnPriceDrop: alertOnPriceDrop ?? false,
      alertThreshold: alertThreshold ?? null,
    },
  });

  // Create demand signal for watchlist add
  await prisma.demandSignal.create({
    data: {
      listingId,
      buyerId: buyer.id,
      type: "WATCHLIST_ADD",
      weight: 0.3,
    },
  });

  return NextResponse.json({ id: item.id, status: "added" });
}

export async function DELETE(req: NextRequest) {
  const buyer = await getDemoBuyer();
  if (!buyer) {
    return NextResponse.json({ error: "No buyer found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listingId");

  if (!listingId) {
    return NextResponse.json(
      { error: "listingId query param is required" },
      { status: 400 }
    );
  }

  await prisma.watchlistItem.deleteMany({
    where: { buyerId: buyer.id, listingId },
  });

  return NextResponse.json({ status: "removed" });
}
