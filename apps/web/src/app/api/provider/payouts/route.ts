import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";


export async function GET() {
  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const payouts = await prisma.payout.findMany({
    where: { providerId: result.profile.id },
    orderBy: { initiatedAt: "desc" },
  });

  return NextResponse.json({
    items: payouts.map((p) => ({
      id: p.id,
      amountUsdc: Number(p.amountUsdc),
      status: p.status,
      destinationAddr: p.destinationAddr,
      txHash: p.txHash,
      chainId: p.chainId,
      initiatedAt: p.initiatedAt.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
      failedAt: p.failedAt?.toISOString() ?? null,
      failureReason: p.failureReason,
    })),
    total: payouts.length,
    page: 1,
    pageSize: payouts.length,
    hasMore: false,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amountUsdc } = body;

  if (!amountUsdc || typeof amountUsdc !== "number" || amountUsdc <= 0) {
    return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });
  }

  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (amountUsdc > Number(result.profile.pendingBalance)) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  const payout = await prisma.payout.create({
    data: {
      providerId: result.profile.id,
      amountUsdc,
      destinationAddr: result.profile.payoutAddress || "0x0000000000000000000000000000000000000000",
      status: "PENDING",
    },
  });

  return NextResponse.json({ id: payout.id, status: payout.status }, { status: 201 });
}
