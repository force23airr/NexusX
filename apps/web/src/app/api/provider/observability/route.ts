import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import { getProviderObservabilitySnapshot } from "@nexusx/database";

function parseWindowHours(value: string | null): number {
  const parsed = Number.parseInt(value || "24", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return Math.min(parsed, 24 * 30);
}

export async function GET(req: NextRequest) {
  const provider = await getCurrentProvider(req);
  if (!provider) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listingId") || undefined;
  const windowHours = parseWindowHours(searchParams.get("windowHours"));

  if (listingId) {
    const ownsListing = await prisma.listing.findFirst({
      where: {
        id: listingId,
        providerId: provider.user.id,
      },
      select: { id: true },
    });

    if (!ownsListing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
  }

  const providerSnapshot = await getProviderObservabilitySnapshot(prisma, {
    providerId: provider.user.id,
    listingId,
    windowHours,
  });

  return NextResponse.json({
    windowHours,
    provider: providerSnapshot,
  });
}
