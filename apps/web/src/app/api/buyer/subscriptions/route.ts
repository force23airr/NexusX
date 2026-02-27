import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const where: Record<string, unknown> = { buyerId: user.id };
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
