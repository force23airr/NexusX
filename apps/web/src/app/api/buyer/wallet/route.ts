import { NextResponse } from "next/server";
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
    lastSyncedAt: w.lastSyncedAt?.toISOString() ?? null,
  });
}
