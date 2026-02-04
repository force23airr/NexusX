import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const profile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
    include: {
      user: {
        include: {
          listings: { where: { status: "ACTIVE" }, select: { id: true } },
        },
      },
    },
  });

  if (!profile) {
    return NextResponse.json({ error: "No provider found" }, { status: 404 });
  }

  return NextResponse.json({
    id: profile.id,
    companyName: profile.companyName,
    totalRevenue: Number(profile.totalRevenue),
    totalPayouts: Number(profile.totalPayouts),
    pendingBalance: Number(profile.pendingBalance),
    payoutAddress: profile.payoutAddress,
    autoPayoutEnabled: profile.autoPayoutEnabled,
    autoPayoutThreshold: Number(profile.autoPayoutThreshold),
    listingCount: profile.user.listings.length,
  });
}
