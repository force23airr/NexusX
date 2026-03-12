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

export async function GET() {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return authErrorResponse(message);
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const sources = await prisma.publicSource.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: { provenances: true },
      },
    },
  });

  return NextResponse.json({
    items: sources.map((source) => ({
      id: source.id,
      name: source.name,
      slug: source.slug,
      sourceType: source.sourceType,
      status: source.status,
      catalogUrl: source.catalogUrl,
      baseUrl: source.baseUrl,
      ownerName: source.ownerName,
      ownerUrl: source.ownerUrl,
      license: source.license,
      attributionRequired: source.attributionRequired,
      allowDiscovery: source.allowDiscovery,
      allowExecution: source.allowExecution,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      lastError: source.lastError,
      linkedListingCount: source._count.provenances,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminUser().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Authentication required";
    return authErrorResponse(message);
  });

  if (admin instanceof NextResponse) {
    return admin;
  }

  const body = await req.json().catch(() => ({}));

  let data: Record<string, unknown>;
  try {
    data = await extractPublicSourceWriteData(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid public source input" },
      { status: 400 },
    );
  }

  const existing = await prisma.publicSource.findUnique({
    where: { slug: data.slug as string },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json(
      { error: "A public source with that slug already exists." },
      { status: 409 },
    );
  }

  const ipAddress = extractIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const created = await prisma.$transaction(async (tx) => {
    const source = await tx.publicSource.create({
      data: data as Prisma.PublicSourceUncheckedCreateInput,
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entityType: "public_source",
        entityId: source.id,
        before: Prisma.JsonNull,
        after: {
          id: source.id,
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

  return NextResponse.json(
    {
      id: created.id,
      slug: created.slug,
      status: created.status,
      allowDiscovery: created.allowDiscovery,
      allowExecution: created.allowExecution,
    },
    { status: 201 },
  );
}
