import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  // Demo: fetch first buyer user
  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
  });
  if (!buyer) {
    return NextResponse.json({ error: "No buyer found" }, { status: 404 });
  }

  const where: any = { buyerId: buyer.id };
  if (status && status !== "all") {
    where.status = status;
  }

  const subscriptions = await prisma.subscription.findMany({
    where,
    orderBy: { startedAt: "desc" },
    include: {
      listing: { select: { name: true } },
    },
  });

  return NextResponse.json(
    subscriptions.map((s) => ({
      id: s.id,
      listingId: s.listingId,
      listingName: s.listing.name,
      status: s.status,
      monthlyBudget: s.monthlyBudgetUsdc ? Number(s.monthlyBudgetUsdc) : null,
      spentThisMonth: Number(s.spentThisMonthUsdc),
      totalCalls: Number(s.totalCalls),
      startedAt: s.startedAt.toISOString(),
      pausedAt: s.pausedAt?.toISOString() ?? null,
      cancelledAt: s.cancelledAt?.toISOString() ?? null,
    }))
  );
}
