import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import {
  persistListingOperationVerificationRun,
  type ListingOperationVerificationSummarySnapshot,
} from "@nexusx/database";
import { extractOperationContracts } from "@/lib/listingOperationContracts";
import {
  buildListingReadinessWriteData,
  evaluateListingReadiness,
} from "@/lib/providerListing";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3100";
const PATH_TEMPLATE_PATTERN = /\{([^}]+)\}/g;

type VerificationOutcome = "verified" | "warning" | "failed" | "skipped";

function deriveReadinessVerificationFields(
  summary: ListingOperationVerificationSummarySnapshot,
) {
  return {
    operationVerificationStatus: summary.rawStatus,
    lastOperationVerificationAt: summary.lastVerifiedAt
      ? new Date(summary.lastVerifiedAt)
      : null,
    operationVerificationVerifiedCount: summary.verifiedCount,
    operationVerificationWarningCount: summary.warningCount,
    operationVerificationFailedCount: summary.failedCount,
    operationVerificationSkippedCount: summary.skippedCount,
  };
}

function resolveOperationPath(
  path: string,
  sampleInput: Record<string, unknown> | null,
): string | null {
  const values = sampleInput ?? {};
  const missing: string[] = [];
  const resolved = path.replace(PATH_TEMPLATE_PATTERN, (_, key: string) => {
    if (!(key in values)) {
      missing.push(key);
      return `{${key}}`;
    }
    return encodeURIComponent(String(values[key]));
  });

  return missing.length === 0 ? resolved : null;
}

function classifyVerification(statusCode: number): {
  outcome: VerificationOutcome;
  reason?: string;
} {
  if (statusCode >= 200 && statusCode < 300) {
    return { outcome: "verified" };
  }
  if (statusCode === 401 || statusCode === 403) {
    return {
      outcome: "warning",
      reason: "upstream rejected the verification request; credentials may be required",
    };
  }
  if (statusCode === 404) {
    return { outcome: "failed", reason: "operation path returned 404" };
  }
  if (statusCode === 405) {
    return { outcome: "failed", reason: "operation method was not allowed" };
  }
  if (statusCode >= 500) {
    return { outcome: "failed", reason: "upstream returned a server error" };
  }
  return { outcome: "warning", reason: `unexpected status ${statusCode}` };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params;
  const body = await req.json().catch(() => ({}));

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

  const allOperations = extractOperationContracts(listing.schemaSpec);
  if (allOperations.length === 0) {
    return NextResponse.json(
      { error: "No operation contracts defined for this listing" },
      { status: 409 },
    );
  }

  const requestedOperationIds = Array.isArray(body.operationIds)
    ? body.operationIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const operations =
    requestedOperationIds.length > 0
      ? allOperations.filter((operation) => requestedOperationIds.includes(operation.operationId))
      : allOperations;

  if (operations.length === 0) {
    return NextResponse.json(
      { error: "No matching operation contracts found for verification" },
      { status: 404 },
    );
  }

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      userId: result.user.id,
      status: "ACTIVE",
    },
    select: { keyPrefix: true },
  });

  if (!apiKey) {
    return NextResponse.json(
      { error: "Create an active API key before running operation verification" },
      { status: 409 },
    );
  }

  const listingSample =
    listing.sampleRequest && typeof listing.sampleRequest === "object" && !Array.isArray(listing.sampleRequest)
      ? (listing.sampleRequest as Record<string, unknown>)
      : null;

  const results = await Promise.all(
    operations.map(async (operation) => {
      const sampleInput = operation.sampleInput ?? listingSample;
      const resolvedPath = resolveOperationPath(operation.path, sampleInput);
      if (!resolvedPath) {
        return {
          operationId: operation.operationId,
          name: operation.name,
          method: operation.method,
          path: operation.path,
          outcome: "skipped" as VerificationOutcome,
          statusCode: 0,
          latencyMs: 0,
          sandboxUsed: Boolean(listing.sandboxUrl),
          reason: "path template parameters are missing from sampleInput",
          responsePreview: "",
        };
      }

      const unsafeWithoutSandbox =
        !listing.sandboxUrl &&
        (operation.sideEffect ||
          operation.method === "POST" ||
          operation.method === "PATCH" ||
          operation.method === "DELETE");
      if (unsafeWithoutSandbox) {
        return {
          operationId: operation.operationId,
          name: operation.name,
          method: operation.method,
          path: operation.path,
          outcome: "skipped" as VerificationOutcome,
          statusCode: 0,
          latencyMs: 0,
          sandboxUsed: false,
          reason: "side-effecting operation requires sandboxUrl for verification",
          responsePreview: "",
        };
      }

      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiKey.keyPrefix}_sandbox`,
        };
        if (listing.sandboxUrl) {
          headers["X-NexusX-Sandbox"] = "true";
        }

        const requestInit: RequestInit = {
          method: operation.method,
          headers,
          signal: controller.signal,
        };

        if (
          operation.method !== "GET" &&
          operation.method !== "DELETE" &&
          sampleInput
        ) {
          headers["Content-Type"] = "application/json";
          requestInit.body = JSON.stringify(sampleInput);
        }

        const upstreamUrl = `${GATEWAY_URL}/v1/${listing.slug}${resolvedPath}`;
        const res = await fetch(upstreamUrl, requestInit);
        clearTimeout(timeout);

        const text = await res.text().catch(() => "");
        const latencyMs = Date.now() - start;
        const classification = classifyVerification(res.status);

        return {
          operationId: operation.operationId,
          name: operation.name,
          method: operation.method,
          path: operation.path,
          outcome: classification.outcome,
          statusCode: res.status,
          latencyMs,
          sandboxUsed: Boolean(listing.sandboxUrl),
          reason: classification.reason ?? null,
          responsePreview: text.length > 400 ? `${text.slice(0, 400)}...` : text,
        };
      } catch (error) {
        const latencyMs = Date.now() - start;
        const message = error instanceof Error ? error.message : "Unknown error";
        return {
          operationId: operation.operationId,
          name: operation.name,
          method: operation.method,
          path: operation.path,
          outcome: "failed" as VerificationOutcome,
          statusCode: 0,
          latencyMs,
          sandboxUsed: Boolean(listing.sandboxUrl),
          reason: message.includes("abort")
            ? "verification request timed out"
            : `verification failed: ${message}`,
          responsePreview: "",
        };
      }
    }),
  );

  const verifiedCount = results.filter((result) => result.outcome === "verified").length;
  const warningCount = results.filter((result) => result.outcome === "warning").length;
  const failedCount = results.filter((result) => result.outcome === "failed").length;
  const skippedCount = results.filter((result) => result.outcome === "skipped").length;

  const persisted = await persistListingOperationVerificationRun(prisma, {
    listingId: listing.id,
    providerId: result.user.id,
    verifiedCount,
    warningCount,
    failedCount,
    skippedCount,
    results: results as unknown as Prisma.InputJsonValue,
  });

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
    ...deriveReadinessVerificationFields(persisted.summary),
  });

  await prisma.listing.update({
    where: { id: listing.id },
    data: buildListingReadinessWriteData(readiness),
  });

  return NextResponse.json({
    listingId: listing.id,
    verifiedCount,
    warningCount,
    failedCount,
    skippedCount,
    summary: persisted.summary,
    run: persisted.run,
    readiness: {
      score: readiness.score,
      readyForActivation: readiness.readyForActivation,
      issues: readiness.blockers,
      warnings: readiness.warnings,
    },
    results,
  });
}
