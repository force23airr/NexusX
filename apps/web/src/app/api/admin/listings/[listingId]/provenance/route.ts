import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { extractListingProvenanceWriteData } from "@/lib/publicSource";
import {
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  bumpControlPlaneVersion,
} from "@nexusx/database";

function authErrorResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: message === "Authentication required" ? 401 : 403 },
  );
}

function extractIpAddress(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return req.headers.get("x-real-ip");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return authErrorResponse(message);
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const { listingId } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      provenance: {
        include: {
          publicSource: true,
        },
      },
    },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  return NextResponse.json({
    listingId: listing.id,
    slug: listing.slug,
    status: listing.status,
    supplyTier: listing.supplyTier,
    verificationState: listing.verificationState,
    verificationReason: listing.verificationReason,
    sourceControlled: listing.sourceControlled,
    provenance: listing.provenance
      ? {
          id: listing.provenance.id,
          kind: listing.provenance.kind,
          publicSourceId: listing.provenance.publicSourceId,
          externalId: listing.provenance.externalId,
          externalUrl: listing.provenance.externalUrl,
          externalVersion: listing.provenance.externalVersion,
          importedAt: listing.provenance.importedAt.toISOString(),
          lastSeenAt: listing.provenance.lastSeenAt?.toISOString() ?? null,
          attribution: listing.provenance.attribution,
          usageNotes: listing.provenance.usageNotes,
          publicSource: listing.provenance.publicSource
            ? {
                id: listing.provenance.publicSource.id,
                slug: listing.provenance.publicSource.slug,
                name: listing.provenance.publicSource.name,
                status: listing.provenance.publicSource.status,
                allowDiscovery: listing.provenance.publicSource.allowDiscovery,
                allowExecution: listing.provenance.publicSource.allowExecution,
              }
            : null,
        }
      : null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return authErrorResponse(message);
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const { listingId } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { provenance: true },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  let updateData: Awaited<ReturnType<typeof extractListingProvenanceWriteData>>;
  try {
    updateData = await extractListingProvenanceWriteData(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid provenance input" },
      { status: 400 },
    );
  }

  const publicSourceId = updateData.provenance.publicSourceId as string | null | undefined;
  if (publicSourceId) {
    const source = await prisma.publicSource.findUnique({
      where: { id: publicSourceId },
      select: { id: true },
    });
    if (!source) {
      return NextResponse.json({ error: "Public source not found" }, { status: 404 });
    }
  }

  const ipAddress = extractIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const result = await prisma.$transaction(async (tx) => {
    const provenance = await tx.listingProvenance.upsert({
      where: { listingId: listing.id },
      create: {
        listingId: listing.id,
        ...(updateData.provenance as Prisma.ListingProvenanceUncheckedCreateInput),
      },
      update: updateData.provenance as Prisma.ListingProvenanceUncheckedUpdateInput,
      include: {
        publicSource: true,
      },
    });

    const updatedListing = await tx.listing.update({
      where: { id: listing.id },
      data: updateData.listing as Prisma.ListingUncheckedUpdateInput,
      select: {
        id: true,
        slug: true,
        supplyTier: true,
        verificationState: true,
        verificationReason: true,
        sourceControlled: true,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "listing_provenance",
        entityId: listing.id,
        before: listing.provenance
          ? ({
              kind: listing.provenance.kind,
              publicSourceId: listing.provenance.publicSourceId,
              externalUrl: listing.provenance.externalUrl,
              supplyTier: listing.supplyTier,
              verificationState: listing.verificationState,
              sourceControlled: listing.sourceControlled,
            } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        after: {
          kind: provenance.kind,
          publicSourceId: provenance.publicSourceId,
          externalUrl: provenance.externalUrl,
          supplyTier: updatedListing.supplyTier,
          verificationState: updatedListing.verificationState,
          sourceControlled: updatedListing.sourceControlled,
        },
        ipAddress,
        userAgent,
      },
    });

    const routeVersion = await bumpControlPlaneVersion(tx);
    const degradationVersion = await bumpControlPlaneVersion(
      tx,
      GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
    );

    return { provenance, updatedListing, routeVersion, degradationVersion };
  });

  return NextResponse.json({
    ok: true,
    listingId: result.updatedListing.id,
    slug: result.updatedListing.slug,
    supplyTier: result.updatedListing.supplyTier,
    verificationState: result.updatedListing.verificationState,
    verificationReason: result.updatedListing.verificationReason,
    sourceControlled: result.updatedListing.sourceControlled,
    provenance: {
      id: result.provenance.id,
      kind: result.provenance.kind,
      publicSourceId: result.provenance.publicSourceId,
      externalUrl: result.provenance.externalUrl,
      externalVersion: result.provenance.externalVersion,
      attribution: result.provenance.attribution,
      usageNotes: result.provenance.usageNotes,
      publicSource: result.provenance.publicSource
        ? {
            id: result.provenance.publicSource.id,
            slug: result.provenance.publicSource.slug,
            status: result.provenance.publicSource.status,
            allowDiscovery: result.provenance.publicSource.allowDiscovery,
            allowExecution: result.provenance.publicSource.allowExecution,
          }
        : null,
    },
    controlPlane: {
      routeVersion: result.routeVersion,
      degradationVersion: result.degradationVersion,
    },
  });
}
