import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { extractPublicSourceWriteData } from "@/lib/publicSource";

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
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return authErrorResponse(message);
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const { sourceId } = await params;
  const source = await prisma.publicSource.findUnique({
    where: { id: sourceId },
    include: {
      provenances: {
        include: {
          listing: {
            select: {
              id: true,
              slug: true,
              name: true,
              status: true,
              supplyTier: true,
              verificationState: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      },
      _count: {
        select: { provenances: true },
      },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "Public source not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: source.id,
    name: source.name,
    slug: source.slug,
    sourceType: source.sourceType,
    status: source.status,
    baseUrl: source.baseUrl,
    catalogUrl: source.catalogUrl,
    ownerName: source.ownerName,
    ownerUrl: source.ownerUrl,
    license: source.license,
    attributionRequired: source.attributionRequired,
    termsUrl: source.termsUrl,
    notes: source.notes,
    allowDiscovery: source.allowDiscovery,
    allowExecution: source.allowExecution,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    lastError: source.lastError,
    linkedListingCount: source._count.provenances,
    listings: source.provenances.map((provenance) => ({
      id: provenance.listing.id,
      slug: provenance.listing.slug,
      name: provenance.listing.name,
      status: provenance.listing.status,
      supplyTier: provenance.listing.supplyTier,
      verificationState: provenance.listing.verificationState,
      kind: provenance.kind,
      externalUrl: provenance.externalUrl,
      importedAt: provenance.importedAt.toISOString(),
      lastSeenAt: provenance.lastSeenAt?.toISOString() ?? null,
    })),
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return authErrorResponse(message);
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const { sourceId } = await params;
  const existing = await prisma.publicSource.findUnique({
    where: { id: sourceId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Public source not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  let data: Record<string, unknown>;
  try {
    data = await extractPublicSourceWriteData(body as Record<string, unknown>, { partial: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid public source input" },
      { status: 400 },
    );
  }

  if (typeof data.slug === "string" && data.slug !== existing.slug) {
    const duplicate = await prisma.publicSource.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "A public source with that slug already exists." },
        { status: 409 },
      );
    }
  }

  const ipAddress = extractIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const updated = await prisma.$transaction(async (tx) => {
    const source = await tx.publicSource.update({
      where: { id: sourceId },
      data: data as Prisma.PublicSourceUncheckedUpdateInput,
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "public_source",
        entityId: source.id,
        before: {
          slug: existing.slug,
          status: existing.status,
          allowDiscovery: existing.allowDiscovery,
          allowExecution: existing.allowExecution,
        },
        after: {
          slug: source.slug,
          status: source.status,
          allowDiscovery: source.allowDiscovery,
          allowExecution: source.allowExecution,
        },
        ipAddress,
        userAgent,
      },
    });

    return source;
  });

  return NextResponse.json({
    id: updated.id,
    slug: updated.slug,
    status: updated.status,
    allowDiscovery: updated.allowDiscovery,
    allowExecution: updated.allowExecution,
    updatedAt: updated.updatedAt.toISOString(),
  });
}
