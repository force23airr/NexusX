import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Demo: fetch first buyer user
  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
    include: { wallet: true },
  });

  if (!buyer || !buyer.wallet) {
    return NextResponse.json({ error: "No buyer wallet found" }, { status: 404 });
  }

  const w = buyer.wallet;
  return NextResponse.json({
    address: w.address,
    chainId: w.chainId,
    balanceUsdc: Number(w.balanceUsdc),
    escrowUsdc: Number(w.escrowUsdc),
    autoDepositEnabled: w.autoDepositEnabled,
    autoDepositAmountUsdc: Number(w.autoDepositAmountUsdc),
    autoDepositThreshold: Number(w.autoDepositThreshold),
    fundingSource: w.fundingSource,
    lastSyncedAt: w.lastSyncedAt?.toISOString() ?? null,
  });
}

// PUT — update auto-deposit settings
export async function PUT(req: NextRequest) {
  const body = await req.json();

  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
    include: { wallet: true },
  });

  if (!buyer || !buyer.wallet) {
    return NextResponse.json({ error: "No buyer wallet found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (body.autoDepositEnabled !== undefined) {
    data.autoDepositEnabled = body.autoDepositEnabled;
  }
  if (body.autoDepositAmountUsdc !== undefined) {
    data.autoDepositAmountUsdc = body.autoDepositAmountUsdc;
  }
  if (body.autoDepositThreshold !== undefined) {
    data.autoDepositThreshold = body.autoDepositThreshold;
  }
  if (body.fundingSource !== undefined) {
    data.fundingSource = body.fundingSource;
  }

  const updated = await prisma.wallet.update({
    where: { id: buyer.wallet.id },
    data,
  });

  return NextResponse.json({
    autoDepositEnabled: updated.autoDepositEnabled,
    autoDepositAmountUsdc: Number(updated.autoDepositAmountUsdc),
    autoDepositThreshold: Number(updated.autoDepositThreshold),
    fundingSource: updated.fundingSource,
  });
}

// POST — simulate a manual deposit (for demo)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const amount = Number(body.amount);

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const buyer = await prisma.user.findFirst({
    where: { roles: { has: "BUYER" } },
    include: { wallet: true },
  });

  if (!buyer || !buyer.wallet) {
    return NextResponse.json({ error: "No buyer wallet found" }, { status: 404 });
  }

  const updated = await prisma.wallet.update({
    where: { id: buyer.wallet.id },
    data: {
      balanceUsdc: { increment: amount },
      lastSyncedAt: new Date(),
    },
  });

  return NextResponse.json({
    balanceUsdc: Number(updated.balanceUsdc),
    deposited: amount,
  });
}
