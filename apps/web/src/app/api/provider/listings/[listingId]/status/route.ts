import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import {
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  bumpControlPlaneVersion,
  enqueueActivationEvent,
} from "@nexusx/database";
import { validateActivationReadiness } from "@/lib/providerListing";

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

  const result = await getCurrentProvider(req);
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (listing.providerId !== result.user.id) {
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

    const readinessErrors = await validateActivationReadiness({
      baseUrl: listing.baseUrl,
      healthCheckUrl: listing.healthCheckUrl,
      sandboxUrl: listing.sandboxUrl,
      docsUrl: listing.docsUrl,
      description: listing.description,
      tags: listing.tags,
      intents: listing.intents,
      capabilityTags: listing.capabilityTags,
    });

    if (readinessErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Listing is not ready for activation",
          details: readinessErrors,
        },
        { status: 422 },
      );
    }

    const data: Record<string, unknown> = { status: "ACTIVE" };
    // Set publishedAt on first activation
    if (!listing.publishedAt) {
      data.publishedAt = new Date();
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextListing = await tx.listing.update({
        where: { id: listingId },
        data,
      });

      await enqueueActivationEvent(tx, {
        type: "LISTING_ACTIVATED",
        listingId,
        timestamp: new Date(),
      });

      await bumpControlPlaneVersion(tx);
      await bumpControlPlaneVersion(tx, GATEWAY_LISTING_DEGRADATION_VERSION_KEY);

      return nextListing;
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

    const updated = await prisma.$transaction(async (tx) => {
      const nextListing = await tx.listing.update({
        where: { id: listingId },
        data: { status: "PAUSED" },
      });
      await bumpControlPlaneVersion(tx);
      await bumpControlPlaneVersion(tx, GATEWAY_LISTING_DEGRADATION_VERSION_KEY);
      return nextListing;
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

    const updated = await prisma.$transaction(async (tx) => {
      const nextListing = await tx.listing.update({
        where: { id: listingId },
        data: {
          status: "DEPRECATED",
          deprecatedAt: new Date(),
        },
      });
      await bumpControlPlaneVersion(tx);
      await bumpControlPlaneVersion(tx, GATEWAY_LISTING_DEGRADATION_VERSION_KEY);
      return nextListing;
    });

    return NextResponse.json({ status: updated.status });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
