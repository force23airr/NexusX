import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { getServerRedis } from "@/lib/serverRedis";
import {
  buildListingReadinessWriteData,
  evaluateListingReadiness,
} from "@/lib/providerListing";
import {
  CIRCUIT_BREAKER_STATE_HASH_KEY,
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  bumpControlPlaneVersion,
  createManualOpenCircuitState,
  enqueueActivationEvent,
  getCircuitProbeKey,
  inspectSharedCircuitState,
  normalizeManualBreakerCooldownMs,
  parseSharedCircuitState,
  serializeSharedCircuitState,
} from "@nexusx/database";

type ControlAction =
  | "activate"
  | "pause"
  | "suspend"
  | "deprecate"
  | "reindex"
  | "quarantine_public"
  | "restore_public"
  | "open_breaker"
  | "close_breaker";

function parseAction(value: unknown): ControlAction | null {
  return value === "activate" ||
    value === "pause" ||
    value === "suspend" ||
    value === "deprecate" ||
    value === "reindex" ||
    value === "quarantine_public" ||
    value === "restore_public" ||
    value === "open_breaker" ||
    value === "close_breaker"
    ? value
    : null;
}

function extractIpAddress(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return req.headers.get("x-real-ip");
}

function authErrorResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: message === "Authentication required" ? 401 : 403 },
  );
}

export async function POST(
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
  const body = await req.json().catch(() => ({}));
  const payload = body as Record<string, unknown>;
  const action = parseAction((body as Record<string, unknown>).action);

  if (!action) {
    return NextResponse.json(
      {
        error:
          "Invalid action. Must be activate, pause, suspend, deprecate, reindex, quarantine_public, restore_public, open_breaker, or close_breaker.",
      },
      { status: 400 },
    );
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      slug: true,
      providerId: true,
      listingType: true,
      status: true,
      publishedAt: true,
      deprecatedAt: true,
      baseUrl: true,
      healthCheckUrl: true,
      sandboxUrl: true,
      docsUrl: true,
      authType: true,
      authSchemes: true,
      interactionModes: true,
      humanApprovalRequired: true,
      noHealthProbe: true,
      riskLevel: true,
      sideEffectLevel: true,
      description: true,
      tags: true,
      intents: true,
      capabilityTags: true,
      inputModalities: true,
      outputModalities: true,
      availabilityRegions: true,
      complianceTags: true,
      sampleRequest: true,
      sampleResponse: true,
      schemaSpec: true,
      domainMetadata: true,
      operationVerificationStatus: true,
      lastOperationVerificationAt: true,
      operationVerificationVerifiedCount: true,
      operationVerificationWarningCount: true,
      operationVerificationFailedCount: true,
      operationVerificationSkippedCount: true,
      supplyTier: true,
      verificationState: true,
      verificationReason: true,
      sourceControlled: true,
    },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const userAgent = req.headers.get("user-agent");
  const ipAddress = extractIpAddress(req);

  if (action === "open_breaker" || action === "close_breaker") {
    const redis = await getServerRedis();
    if (!redis) {
      return NextResponse.json(
        { error: "Redis is required for manual circuit breaker control." },
        { status: 503 },
      );
    }

    const previousRaw = await redis.hget(CIRCUIT_BREAKER_STATE_HASH_KEY, listing.slug);
    const previousState = parseSharedCircuitState(previousRaw);

    try {
      if (action === "open_breaker") {
        const requestedCooldownMs = payload.cooldownMs;
        const cooldownMs = normalizeManualBreakerCooldownMs(
          typeof requestedCooldownMs === "number"
            ? requestedCooldownMs
            : typeof requestedCooldownMs === "string"
              ? Number(requestedCooldownMs)
              : undefined,
        );
        const nextState = createManualOpenCircuitState({ cooldownMs });

        await redis.hset(
          CIRCUIT_BREAKER_STATE_HASH_KEY,
          listing.slug,
          serializeSharedCircuitState(nextState),
        );
        await redis.del(getCircuitProbeKey(listing.slug));

        const degradationVersion = await prisma.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: {
              actorId: admin.id,
              action: "UPDATE",
              entityType: "circuit_breaker",
              entityId: listing.id,
              before: previousState ? ({ ...previousState } as Prisma.InputJsonValue) : Prisma.JsonNull,
              after: ({
                slug: listing.slug,
                state: inspectSharedCircuitState(listing.slug, nextState),
                action: "open_breaker",
              } as unknown as Prisma.InputJsonValue),
              ipAddress,
              userAgent,
            },
          });

          return bumpControlPlaneVersion(tx, GATEWAY_LISTING_DEGRADATION_VERSION_KEY);
        });

        return NextResponse.json({
          ok: true,
          action,
          listingId: listing.id,
          slug: listing.slug,
          breaker: inspectSharedCircuitState(listing.slug, nextState),
          controlPlane: {
            degradationVersion,
          },
        });
      }

      await redis.hdel(CIRCUIT_BREAKER_STATE_HASH_KEY, listing.slug);
      await redis.del(getCircuitProbeKey(listing.slug));

      const degradationVersion = await prisma.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "UPDATE",
            entityType: "circuit_breaker",
            entityId: listing.id,
            before: previousState ? ({ ...previousState } as Prisma.InputJsonValue) : Prisma.JsonNull,
            after: ({
              slug: listing.slug,
              state: "closed",
              action: "close_breaker",
            } as unknown as Prisma.InputJsonValue),
            ipAddress,
            userAgent,
          },
        });

        return bumpControlPlaneVersion(tx, GATEWAY_LISTING_DEGRADATION_VERSION_KEY);
      });

      return NextResponse.json({
        ok: true,
        action,
        listingId: listing.id,
        slug: listing.slug,
        breaker: {
          slug: listing.slug,
          state: "closed",
        },
        controlPlane: {
          degradationVersion,
        },
      });
    } catch (error) {
      if (previousRaw) {
        await redis.hset(CIRCUIT_BREAKER_STATE_HASH_KEY, listing.slug, previousRaw);
      } else {
        await redis.hdel(CIRCUIT_BREAKER_STATE_HASH_KEY, listing.slug);
      }
      await redis.del(getCircuitProbeKey(listing.slug));

      console.error("[AdminListingControl] Circuit breaker mutation failed:", error, {
        listingId: listing.id,
        action,
      });
      return NextResponse.json(
        { error: "Failed to mutate shared circuit breaker state." },
        { status: 500 },
      );
    }
  }

  if (action === "activate") {
    if (!["DRAFT", "PAUSED", "SUSPENDED"].includes(listing.status)) {
      return NextResponse.json(
        { error: `Cannot activate from ${listing.status}. Must be DRAFT, PAUSED, or SUSPENDED.` },
        { status: 409 },
      );
    }

    const readiness = await evaluateListingReadiness({
      listingType: listing.listingType,
      baseUrl: listing.baseUrl,
      healthCheckUrl: listing.healthCheckUrl,
      sandboxUrl: listing.sandboxUrl,
      docsUrl: listing.docsUrl,
      authType: listing.authType,
      authSchemes: listing.authSchemes,
      interactionModes: listing.interactionModes,
      humanApprovalRequired: listing.humanApprovalRequired,
      noHealthProbe: listing.noHealthProbe,
      riskLevel: listing.riskLevel,
      sideEffectLevel: listing.sideEffectLevel,
      description: listing.description,
      tags: listing.tags,
      intents: listing.intents,
      capabilityTags: listing.capabilityTags,
      inputModalities: listing.inputModalities,
      outputModalities: listing.outputModalities,
      availabilityRegions: listing.availabilityRegions,
      complianceTags: listing.complianceTags,
      sampleRequest: listing.sampleRequest,
      sampleResponse: listing.sampleResponse,
      schemaSpec: listing.schemaSpec,
      domainMetadata: listing.domainMetadata,
      operationVerificationStatus: listing.operationVerificationStatus,
      lastOperationVerificationAt: listing.lastOperationVerificationAt,
      operationVerificationVerifiedCount: listing.operationVerificationVerifiedCount,
      operationVerificationWarningCount: listing.operationVerificationWarningCount,
      operationVerificationFailedCount: listing.operationVerificationFailedCount,
      operationVerificationSkippedCount: listing.operationVerificationSkippedCount,
    });

    if (!readiness.readyForActivation) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: buildListingReadinessWriteData(readiness),
      });
      return NextResponse.json(
        {
          error: "Listing is not ready for activation",
          details: readiness.blockers,
          warnings: readiness.warnings,
          readinessScore: readiness.score,
        },
        { status: 422 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: {
          status: "ACTIVE",
          publishedAt: listing.publishedAt ?? new Date(),
          ...buildListingReadinessWriteData(readiness),
        },
      });

      await enqueueActivationEvent(tx, {
        type: "LISTING_ACTIVATED",
        listingId: listing.id,
        timestamp: new Date(),
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "ACTIVATE",
          entityType: "listing",
          entityId: listing.id,
          before: { status: listing.status },
          after: { status: "ACTIVE" },
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
      listingId: listing.id,
      slug: listing.slug,
      status: result.updated.status,
      controlPlane: {
        routeVersion: result.routeVersion,
        degradationVersion: result.degradationVersion,
      },
    });
  }

  if (action === "pause") {
    if (listing.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `Cannot pause from ${listing.status}. Must be ACTIVE.` },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: { status: "PAUSED" },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entityType: "listing",
          entityId: listing.id,
          before: { status: listing.status },
          after: { status: "PAUSED" },
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
      listingId: listing.id,
      slug: listing.slug,
      status: result.updated.status,
      controlPlane: {
        routeVersion: result.routeVersion,
        degradationVersion: result.degradationVersion,
      },
    });
  }

  if (action === "suspend") {
    if (listing.status === "SUSPENDED") {
      return NextResponse.json({ ok: true, action, listingId: listing.id, slug: listing.slug, status: listing.status });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: { status: "SUSPENDED" },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "SUSPEND",
          entityType: "listing",
          entityId: listing.id,
          before: { status: listing.status },
          after: { status: "SUSPENDED" },
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
      listingId: listing.id,
      slug: listing.slug,
      status: result.updated.status,
      controlPlane: {
        routeVersion: result.routeVersion,
        degradationVersion: result.degradationVersion,
      },
    });
  }

  if (action === "deprecate") {
    if (listing.status === "DEPRECATED") {
      return NextResponse.json({ ok: true, action, listingId: listing.id, slug: listing.slug, status: listing.status });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: {
          status: "DEPRECATED",
          deprecatedAt: listing.deprecatedAt ?? new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entityType: "listing",
          entityId: listing.id,
          before: { status: listing.status },
          after: { status: "DEPRECATED" },
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
      listingId: listing.id,
      slug: listing.slug,
      status: result.updated.status,
      controlPlane: {
        routeVersion: result.routeVersion,
        degradationVersion: result.degradationVersion,
      },
    });
  }

  if (action === "quarantine_public" || action === "restore_public") {
    if (!listing.sourceControlled) {
      return NextResponse.json(
        { error: "This action only applies to source-controlled public listings." },
        { status: 409 },
      );
    }

    const reason =
      typeof payload.reason === "string" && payload.reason.trim().length > 0
        ? payload.reason.trim().slice(0, 500)
        : null;

    const nextSupplyTier = action === "quarantine_public" ? "PUBLIC_QUARANTINED" : "PUBLIC_VERIFIED";
    const nextVerificationState = action === "quarantine_public" ? "QUARANTINED" : "VERIFIED";
    const nextReason = action === "quarantine_public" ? (reason ?? listing.verificationReason ?? "Quarantined by admin") : null;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: {
          supplyTier: nextSupplyTier,
          verificationState: nextVerificationState,
          verificationReason: nextReason,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entityType: "listing_public_state",
          entityId: listing.id,
          before: {
            supplyTier: listing.supplyTier,
            verificationState: listing.verificationState,
            verificationReason: listing.verificationReason,
          },
          after: {
            supplyTier: nextSupplyTier,
            verificationState: nextVerificationState,
            verificationReason: nextReason,
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
      listingId: listing.id,
      slug: listing.slug,
      supplyTier: result.updated.supplyTier,
      verificationState: result.updated.verificationState,
      verificationReason: result.updated.verificationReason,
      controlPlane: {
        routeVersion: result.routeVersion,
        degradationVersion: result.degradationVersion,
      },
    });
  }

  if (listing.status !== "ACTIVE") {
    return NextResponse.json(
      { error: `Cannot reindex from ${listing.status}. Listing must be ACTIVE.` },
      { status: 409 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await enqueueActivationEvent(tx, {
      type: "LISTING_ACTIVATED",
      listingId: listing.id,
      timestamp: new Date(),
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "listing_index",
        entityId: listing.id,
        before: { status: listing.status },
        after: { reindexQueued: true },
        ipAddress,
        userAgent,
      },
    });

    return true;
  });

  return NextResponse.json({
    ok: result,
    action,
    listingId: listing.id,
    slug: listing.slug,
    reindexQueued: true,
  });
}
