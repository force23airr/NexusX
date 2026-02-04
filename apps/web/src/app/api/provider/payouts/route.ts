import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET() {
  // Demo: fetch first provider
  const profile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!profile) {
    return NextResponse.json({ error: "No provider found" }, { status: 404 });
  }

  const payouts = await prisma.payout.findMany({
    where: { providerId: profile.id },
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

  const profile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!profile) {
    return NextResponse.json({ error: "No provider found" }, { status: 404 });
  }

  if (amountUsdc > Number(profile.pendingBalance)) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  const payout = await prisma.payout.create({
    data: {
      providerId: profile.id,
      amountUsdc,
      destinationAddr: profile.payoutAddress || "0x0000000000000000000000000000000000000000",
      status: "PENDING",
    },
  });

  return NextResponse.json({ id: payout.id, status: payout.status }, { status: 201 });
}
