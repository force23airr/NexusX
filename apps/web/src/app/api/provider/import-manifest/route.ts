import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import { isPrivateHost } from "@/lib/ssrf";
import { validateManifest } from "@nexusx/database";
import type { ListingType } from "@prisma/client";

/**
 * POST /api/provider/import-manifest
 *
 * Fetches /.well-known/nexusx.json from a domain and creates
 * DRAFT listings for each capability in the manifest.
 *
 * Request: { "domain": "example.com" }
 */
export async function POST(req: NextRequest) {
  const result = await getCurrentProvider();
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

  // SSRF check
  if (isPrivateHost(domain)) {
    return NextResponse.json({ error: "Private/reserved addresses are not allowed" }, { status: 400 });
  }

  // Fetch manifest
  const manifestUrl = `https://${domain}/.well-known/nexusx.json`;
  let manifestData: unknown;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(manifestUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
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
      const listing = await prisma.listing.create({
        data: {
          providerId: result.user.id,
          categoryId,
          slug,
          name: cap.name,
          description: cap.description,
          listingType: (cap.listingType || "REST_API") as ListingType,
          status: "DRAFT",
          baseUrl: cap.baseUrl,
          healthCheckUrl: cap.healthCheckUrl || null,
          docsUrl: cap.docsUrl || null,
          authType: cap.authType || "api_key",
          floorPriceUsdc: cap.pricing.floorUsdc,
          ceilingPriceUsdc: cap.pricing.ceilingUsdc || null,
          currentPriceUsdc: cap.pricing.floorUsdc,
          capacityPerMinute: cap.capacityPerMinute || 60,
          isUnique: false,
          tags: cap.tags || [],
          intents: cap.intents,
          sampleRequest: cap.sampleRequest ? JSON.parse(JSON.stringify(cap.sampleRequest)) : undefined,
          sampleResponse: cap.sampleResponse ? JSON.parse(JSON.stringify(cap.sampleResponse)) : undefined,
        },
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
