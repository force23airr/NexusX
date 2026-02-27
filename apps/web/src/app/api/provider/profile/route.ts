import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";


export async function GET() {
  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { profile } = result;

  const listingCount = await prisma.listing.count({
    where: { providerId: result.user.id, status: "ACTIVE" },
  });

  return NextResponse.json({
    id: profile.id,
    companyName: profile.companyName,
    totalRevenue: Number(profile.totalRevenue),
    totalPayouts: Number(profile.totalPayouts),
    pendingBalance: Number(profile.pendingBalance),
    payoutAddress: profile.payoutAddress,
    autoPayoutEnabled: profile.autoPayoutEnabled,
    autoPayoutThreshold: Number(profile.autoPayoutThreshold),
    listingCount,
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

  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  await prisma.providerProfile.update({
    where: { id: result.profile.id },
    data: { payoutAddress },
  });

  return NextResponse.json({ success: true });
}
