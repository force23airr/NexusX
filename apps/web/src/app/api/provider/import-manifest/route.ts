import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import { assertSafeHttpUrl, safeFetch } from "@/lib/ssrf";
import {
  buildListingReadinessWriteData,
  evaluateListingReadiness,
  extractListingWriteData,
} from "@/lib/providerListing";
import { buildDetectedOperationContract } from "@/lib/listingOperationContracts";
import { validateManifest } from "@nexusx/database";
import { Prisma, type ListingType } from "@prisma/client";

/**
 * POST /api/provider/import-manifest
 *
 * Fetches /.well-known/nexusx.json from a domain and creates
 * DRAFT listings for each capability in the manifest.
 *
 * Request: { "domain": "example.com" }
 */
export async function POST(req: NextRequest) {
  const result = await getCurrentProvider(req);
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { domain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const domain = body.domain?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain) {
    return NextResponse.json({ error: "Domain is required" }, { status: 400 });
  }

  // Fetch manifest
  const manifestUrl = `https://${domain}/.well-known/nexusx.json`;
  let manifestData: unknown;

  try {
    await assertSafeHttpUrl(manifestUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await safeFetch(manifestUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }, { maxRedirects: 2 });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch manifest: HTTP ${res.status}` },
        { status: 422 },
      );
    }

    manifestData = await res.json();
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "Request timed out (10s)"
      : "Failed to fetch manifest from domain";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  // Validate
  const validation = validateManifest(manifestData);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Invalid manifest", details: (validation as { valid: false; errors: string[] }).errors },
      { status: 422 },
    );
  }

  const { manifest } = validation as { valid: true; manifest: import("@nexusx/database").NexusXManifest };

  // Load categories for slug → id mapping
  const categories = await prisma.category.findMany({
    select: { id: true, slug: true },
  });
  const categoryMap = new Map(categories.map((c) => [c.slug, c.id]));

  // Find a fallback category
  const fallbackCategory = categories[0];

  const imported: { id: string; slug: string; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const toUniqueUpper = (values?: string[]) =>
    Array.from(
      new Set(
        (values || [])
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim().toUpperCase()),
      ),
    );

  for (const cap of manifest.capabilities) {
    // Resolve category
    const categoryId = categoryMap.get(cap.category) ?? fallbackCategory?.id;
    if (!categoryId) {
      skipped.push({ name: cap.name, reason: "No matching category and no fallback available" });
      continue;
    }

    // Generate unique slug
    let slug = cap.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const existingSlug = await prisma.listing.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    try {
      const capabilityTags = Array.from(
        new Set([...(cap.capabilityTags || []), ...(cap.tags || []), ...cap.intents]),
      );
      const latencyRegions = toUniqueUpper(cap.latencyRegions);
      const routingRegions = toUniqueUpper(cap.routingRegions);
      const edgeRegions = toUniqueUpper(cap.edgeRegions);
      const operationContracts = Array.isArray(cap.operations) && cap.operations.length > 0
        ? cap.operations.slice(0, 20).map((operation) =>
            buildDetectedOperationContract({
              operationId: operation.operationId,
              name: operation.name,
              description: operation.description,
              method: operation.method,
              path: operation.path,
              mode: operation.mode,
              authScheme: operation.authScheme || cap.authType || "api_key",
              inputSchema: operation.inputSchema || null,
              outputSchema: operation.outputSchema || null,
              sampleInput: operation.sampleInput || null,
              sampleOutput: operation.sampleOutput || null,
            }),
          )
        : cap.endpoint
          ? [
              buildDetectedOperationContract({
                name: cap.name,
                description: cap.description,
                method: cap.endpoint.method,
                path: cap.endpoint.path,
                authScheme: cap.authType || "api_key",
                sampleInput: cap.sampleRequest ? JSON.parse(JSON.stringify(cap.sampleRequest)) : null,
                sampleOutput: cap.sampleResponse ? JSON.parse(JSON.stringify(cap.sampleResponse)) : null,
              }),
            ]
          : [];
      const listingData = await extractListingWriteData({
        name: cap.name,
        description: cap.description,
        listingType: (cap.listingType || "REST_API") as ListingType,
        baseUrl: cap.baseUrl,
        healthCheckUrl: cap.healthCheckUrl || null,
        docsUrl: cap.docsUrl || null,
        authType: cap.authType || "api_key",
        floorPriceUsdc: cap.pricing.floorUsdc,
        ceilingPriceUsdc: cap.pricing.ceilingUsdc || null,
        capacityPerMinute: cap.capacityPerMinute || 60,
        tags: cap.tags || [],
        intents: cap.intents,
        availabilityRegions: cap.availabilityRegions || [],
        restrictedRegions: cap.restrictedRegions || [],
        complianceTags: cap.complianceTags || [],
        capabilityTags,
        inputModalities: cap.inputModalities || [],
        outputModalities: cap.outputModalities || [],
        domainMetadata: {
          ...(cap.domainMetadata || {}),
          manifestProvider: manifest.provider.name,
          manifestVersion: manifest.version,
          endpoint: cap.endpoint ?? null,
          ...(latencyRegions.length > 0 || routingRegions.length > 0 || edgeRegions.length > 0
            ? {
                nexusxRouting: {
                  ...(latencyRegions.length > 0 ? { latencyRegions } : {}),
                  ...(routingRegions.length > 0 ? { routingRegions } : {}),
                  ...(edgeRegions.length > 0 ? { edgeRegions } : {}),
                },
              }
            : {}),
        },
        sampleRequest: cap.sampleRequest ? JSON.parse(JSON.stringify(cap.sampleRequest)) : undefined,
        sampleResponse: cap.sampleResponse ? JSON.parse(JSON.stringify(cap.sampleResponse)) : undefined,
        operationContracts: operationContracts.length > 0 ? operationContracts : undefined,
      });

      const listingType = (listingData.listingType as ListingType) ?? ((cap.listingType || "REST_API") as ListingType);
      const authType = (listingData.authType as string | undefined) ?? cap.authType ?? "api_key";
      const authSchemes = (listingData.authSchemes as string[] | undefined) ?? [];
      const interactionModes = (listingData.interactionModes as string[] | undefined) ?? [];
      const humanApprovalRequired = (listingData.humanApprovalRequired as boolean | undefined) ?? false;
      const noHealthProbe = (listingData.noHealthProbe as boolean | undefined) ?? false;
      const riskLevel = (listingData.riskLevel as Prisma.ListingUncheckedCreateInput["riskLevel"]) ?? "LOW";
      const sideEffectLevel = (listingData.sideEffectLevel as Prisma.ListingUncheckedCreateInput["sideEffectLevel"]) ?? "READ_ONLY";
      const readiness = await evaluateListingReadiness({
        listingType,
        baseUrl: listingData.baseUrl as string,
        healthCheckUrl: (listingData.healthCheckUrl as string | null | undefined) ?? null,
        sandboxUrl: (listingData.sandboxUrl as string | null | undefined) ?? null,
        docsUrl: (listingData.docsUrl as string | null | undefined) ?? null,
        authType,
        authSchemes,
        interactionModes,
        humanApprovalRequired,
        noHealthProbe,
        riskLevel,
        sideEffectLevel,
        description: (listingData.description as string) ?? cap.description,
        tags: (listingData.tags as string[] | undefined) ?? [],
        intents: (listingData.intents as string[] | undefined) ?? cap.intents,
        capabilityTags: (listingData.capabilityTags as string[] | undefined) ?? capabilityTags,
        inputModalities: (listingData.inputModalities as string[] | undefined) ?? (cap.inputModalities || []),
        outputModalities: (listingData.outputModalities as string[] | undefined) ?? (cap.outputModalities || []),
        availabilityRegions: (listingData.availabilityRegions as string[] | undefined) ?? (cap.availabilityRegions || []),
        complianceTags: (listingData.complianceTags as string[] | undefined) ?? (cap.complianceTags || []),
        sampleRequest: listingData.sampleRequest as Prisma.JsonValue | null | undefined,
        sampleResponse: listingData.sampleResponse as Prisma.JsonValue | null | undefined,
        schemaSpec: listingData.schemaSpec as Prisma.JsonValue | null | undefined,
        domainMetadata: listingData.domainMetadata as Prisma.JsonValue | null | undefined,
      });

      const createData: Prisma.ListingUncheckedCreateInput = {
        providerId: result.user.id,
        categoryId,
        slug,
        status: "DRAFT",
        currentPriceUsdc: Number(listingData.floorPriceUsdc ?? cap.pricing.floorUsdc),
        isUnique: false,
        ...buildListingReadinessWriteData(readiness),
        ...listingData,
      } as Prisma.ListingUncheckedCreateInput;

      const listing = await prisma.listing.create({
        data: createData,
      });

      imported.push({ id: listing.id, slug: listing.slug, name: listing.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      skipped.push({ name: cap.name, reason: message });
    }
  }

  return NextResponse.json({
    imported: imported.length,
    skipped: skipped.length,
    listings: imported,
    skippedDetails: skipped,
    manifestProvider: manifest.provider,
  });
}
