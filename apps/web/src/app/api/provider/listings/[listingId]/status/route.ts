import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────
// POST /api/provider/listings/[listingId]/status
// Transition listing status: activate, pause, deprecate.
// ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;
  const body = await req.json();
  const action = body.action as string;

  if (!["activate", "pause", "deprecate"].includes(action)) {
    return NextResponse.json(
      { error: "Invalid action. Must be: activate, pause, or deprecate." },
      { status: 400 }
    );
  }

  // Demo auth
  const profile = await prisma.providerProfile.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!profile) {
    return NextResponse.json({ error: "No provider profile found" }, { status: 403 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (listing.providerId !== profile.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate transitions
  const current = listing.status;

  if (action === "activate") {
    if (current !== "DRAFT" && current !== "PAUSED") {
      return NextResponse.json(
        { error: `Cannot activate from ${current}. Must be DRAFT or PAUSED.` },
        { status: 409 }
      );
    }

    const data: Record<string, unknown> = { status: "ACTIVE" };
    // Set publishedAt on first activation
    if (!listing.publishedAt) {
      data.publishedAt = new Date();
    }

    const updated = await prisma.listing.update({
      where: { id: listingId },
      data,
    });

    return NextResponse.json({ status: updated.status });
  }

  if (action === "pause") {
    if (current !== "ACTIVE") {
      return NextResponse.json(
        { error: `Cannot pause from ${current}. Must be ACTIVE.` },
        { status: 409 }
      );
    }

    const updated = await prisma.listing.update({
      where: { id: listingId },
      data: { status: "PAUSED" },
    });

    return NextResponse.json({ status: updated.status });
  }

  if (action === "deprecate") {
    if (current === "DEPRECATED") {
      return NextResponse.json(
        { error: "Listing is already deprecated." },
        { status: 409 }
      );
    }

    const updated = await prisma.listing.update({
      where: { id: listingId },
      data: {
        status: "DEPRECATED",
        deprecatedAt: new Date(),
      },
    });

    return NextResponse.json({ status: updated.status });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
