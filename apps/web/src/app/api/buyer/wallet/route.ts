import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
  });

  if (!wallet) {
    return NextResponse.json({ error: "No wallet found" }, { status: 404 });
  }

  return NextResponse.json({
    address: wallet.address,
    chainId: wallet.chainId,
    balanceUsdc: Number(wallet.balanceUsdc),
    escrowUsdc: Number(wallet.escrowUsdc),
    autoDepositEnabled: wallet.autoDepositEnabled,
    autoDepositAmountUsdc: Number(wallet.autoDepositAmountUsdc),
    autoDepositThreshold: Number(wallet.autoDepositThreshold),
    fundingSource: wallet.fundingSource,
    lastSyncedAt: wallet.lastSyncedAt?.toISOString() ?? null,
  });
}

// PUT — update auto-deposit settings
export async function PUT(req: NextRequest) {
  const body = await req.json();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
  });

  if (!wallet) {
    return NextResponse.json({ error: "No wallet found" }, { status: 404 });
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
    where: { id: wallet.id },
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

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
  });

  if (!wallet) {
    return NextResponse.json({ error: "No wallet found" }, { status: 404 });
  }

  const updated = await prisma.wallet.update({
    where: { id: wallet.id },
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
