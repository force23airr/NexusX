import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import {
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  bumpControlPlaneVersion,
} from "@nexusx/database";

type SourceControlAction =
  | "enable"
  | "pause"
  | "disable"
  | "block"
  | "allow_discovery"
  | "deny_discovery"
  | "allow_execution"
  | "deny_execution";

function parseAction(value: unknown): SourceControlAction | null {
  return value === "enable" ||
    value === "pause" ||
    value === "disable" ||
    value === "block" ||
    value === "allow_discovery" ||
    value === "deny_discovery" ||
    value === "allow_execution" ||
    value === "deny_execution"
    ? value
    : null;
}

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

export async function POST(
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
  const body = await req.json().catch(() => ({}));
  const payload = body as Record<string, unknown>;
  const action = parseAction(payload.action);

  if (!action) {
    return NextResponse.json(
      {
        error:
          "Invalid action. Must be enable, pause, disable, block, allow_discovery, deny_discovery, allow_execution, or deny_execution.",
      },
      { status: 400 },
    );
  }

  const source = await prisma.publicSource.findUnique({
    where: { id: sourceId },
    include: { _count: { select: { provenances: true } } },
  });

  if (!source) {
    return NextResponse.json({ error: "Public source not found" }, { status: 404 });
  }

  const ipAddress = extractIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const result = await prisma.$transaction(async (tx) => {
    const data: Prisma.PublicSourceUpdateInput = {};

    switch (action) {
      case "enable":
        data.status = "ACTIVE";
        break;
      case "pause":
        data.status = "PAUSED";
        break;
      case "disable":
        data.status = "DISABLED";
        data.allowDiscovery = false;
        data.allowExecution = false;
        break;
      case "block":
        data.status = "BLOCKED";
        data.allowDiscovery = false;
        data.allowExecution = false;
        break;
      case "allow_discovery":
        data.allowDiscovery = true;
        break;
      case "deny_discovery":
        data.allowDiscovery = false;
        break;
      case "allow_execution":
        data.allowExecution = true;
        break;
      case "deny_execution":
        data.allowExecution = false;
        break;
    }

    const updated = await tx.publicSource.update({
      where: { id: sourceId },
      data,
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "public_source",
        entityId: source.id,
        before: {
          status: source.status,
          allowDiscovery: source.allowDiscovery,
          allowExecution: source.allowExecution,
        },
        after: {
          status: updated.status,
          allowDiscovery: updated.allowDiscovery,
          allowExecution: updated.allowExecution,
          action,
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

    return { updated, routeVersion, degradationVersion };
  });

  return NextResponse.json({
    ok: true,
    action,
    source: {
      id: result.updated.id,
      slug: result.updated.slug,
      status: result.updated.status,
      allowDiscovery: result.updated.allowDiscovery,
      allowExecution: result.updated.allowExecution,
      linkedListingCount: source._count.provenances,
    },
    controlPlane: {
      routeVersion: result.routeVersion,
      degradationVersion: result.degradationVersion,
    },
  });
}
