import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET() {
  const listings = await prisma.listing.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      currentPriceUsdc: true,
      floorPriceUsdc: true,
    },
    orderBy: { totalCalls: "desc" },
    take: 20,
  });

  const ticks = listings.map((l) => {
    const current = Number(l.currentPriceUsdc);
    const floor = Number(l.floorPriceUsdc);
    const changePercent = floor > 0 ? ((current - floor) / floor) * 100 : 0;
    const direction: "up" | "down" | "flat" =
      changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";

    return {
      listingId: l.id,
      slug: l.slug,
      name: l.name,
      currentPrice: current,
      previousPrice: floor,
      changePercent: Math.round(changePercent * 10) / 10,
      direction,
    };
  });

  return NextResponse.json(ticks);
}
