import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


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

export async function PATCH(req: NextRequest) {
  let body: { payoutAddress?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { payoutAddress } = body;
  if (!payoutAddress || !/^0x[a-fA-F0-9]{40}$/.test(payoutAddress)) {
    return NextResponse.json(
      { error: "Invalid Ethereum address format" },
      { status: 400 }
    );
  }

  const profile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!profile) {
    return NextResponse.json({ error: "No provider found" }, { status: 404 });
  }

  await prisma.providerProfile.update({
    where: { id: profile.id },
    data: { payoutAddress },
  });

  return NextResponse.json({ success: true });
}
