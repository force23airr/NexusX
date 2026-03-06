import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import { extractListingWriteData } from "@/lib/providerListing";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = 20;

  const result = await getCurrentProvider(req);
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const where: Record<string, unknown> = { providerId: result.user.id };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: true,
        qualitySnapshots: {
          orderBy: { computedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  const listings = items.map((l) => {
    const quality = l.qualitySnapshots[0];
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      description: l.description,
      listingType: l.listingType,
      status: l.status,
      categorySlug: l.category.slug,
      providerName: "",
      providerId: l.providerId,
      baseUrl: l.baseUrl,
      floorPriceUsdc: Number(l.floorPriceUsdc),
      currentPriceUsdc: Number(l.currentPriceUsdc),
      ceilingPriceUsdc: l.ceilingPriceUsdc ? Number(l.ceilingPriceUsdc) : null,
      capacityPerMinute: l.capacityPerMinute,
      isUnique: l.isUnique,
      tags: l.tags,
      totalCalls: Number(l.totalCalls),
      totalRevenue: Number(l.totalRevenue),
      avgRating: Number(l.avgRating),
      ratingCount: l.ratingCount,
      qualityScore: quality ? Number(quality.compositeScore) : 0,
      avgLatencyMs: quality ? Number(quality.medianLatencyMs) : 0,
      uptimePercent: quality ? Number(quality.uptimePercent) : 100,
      availabilityRegions: l.availabilityRegions,
      restrictedRegions: l.restrictedRegions,
      complianceTags: l.complianceTags,
      capabilityTags: l.capabilityTags,
      inputModalities: l.inputModalities,
      outputModalities: l.outputModalities,
      domainMetadata: l.domainMetadata,
      publishedAt: l.publishedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    };
  });

  return NextResponse.json({
    items: listings,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Validate required fields (categorySlug accepted instead of categoryId)
  const required = ["name", "baseUrl", "floorPriceUsdc"];
  for (const field of required) {
    if (!body[field] && body[field] !== 0) {
      return NextResponse.json(
        { error: `Missing required field: ${field}` },
        { status: 400 }
      );
    }
  }

  const result = await getCurrentProvider(req);
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let writeData: Record<string, unknown>;
  try {
    writeData = await extractListingWriteData(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid listing input" },
      { status: 400 },
    );
  }

  // Resolve category — accept categoryId or categorySlug
  let categoryId: string = body.categoryId;
  if (!categoryId && body.categorySlug) {
    const cat = await prisma.category.findFirst({ where: { slug: body.categorySlug } });
    if (cat) categoryId = cat.id;
  }
  if (!categoryId) {
    // Fall back to first available category
    const fallback = await prisma.category.findFirst({ orderBy: { name: "asc" } });
    if (!fallback) {
      return NextResponse.json({ error: "No categories available" }, { status: 400 });
    }
    categoryId = fallback.id;
  }

  // Generate slug — deduplicate if needed
  let slug = body.slug || body.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const existing = await prisma.listing.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  // Store videoUrl in schemaSpec JSON
  // Merge user tags with sector tags (sector:value convention for filtering)
  const tags: string[] = Array.isArray(writeData.tags) ? [...(writeData.tags as string[])] : [];
  const sectors: string[] = body.sectors || [];
  for (const s of sectors) {
    const tag = `sector:${String(s).trim()}`;
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  const createData: Prisma.ListingUncheckedCreateInput = {
    providerId: result.user.id,
    categoryId,
    slug,
    name: (writeData.name as string | undefined) ?? body.name,
    description: (writeData.description as string | undefined) ?? (body.description || ""),
    listingType: ((writeData.listingType as string | undefined) ?? (body.listingType || "REST_API")) as any,
    status: "DRAFT",
    baseUrl: writeData.baseUrl as string,
    healthCheckUrl: (writeData.healthCheckUrl as string | null | undefined) ?? null,
    docsUrl: (writeData.docsUrl as string | null | undefined) ?? null,
    sandboxUrl: (writeData.sandboxUrl as string | null | undefined) ?? null,
    authType: (writeData.authType as string | undefined) || "api_key",
    floorPriceUsdc: Number(writeData.floorPriceUsdc ?? body.floorPriceUsdc),
    ceilingPriceUsdc: (writeData.ceilingPriceUsdc as number | null | undefined) ?? null,
    currentPriceUsdc: Number(writeData.floorPriceUsdc ?? body.floorPriceUsdc),
    capacityPerMinute: Number((writeData.capacityPerMinute ?? body.capacityPerMinute) || 60),
    isUnique: Boolean((writeData.isUnique ?? body.isUnique) || false),
    tags,
    intents: (writeData.intents as string[] | undefined) ?? [],
    sampleRequest: (writeData.sampleRequest as Prisma.InputJsonValue | undefined) ?? undefined,
    sampleResponse: (writeData.sampleResponse as Prisma.InputJsonValue | undefined) ?? undefined,
    schemaSpec: (writeData.schemaSpec as Prisma.InputJsonValue | undefined) ?? undefined,
    availabilityRegions: (writeData.availabilityRegions as string[] | undefined) ?? [],
    restrictedRegions: (writeData.restrictedRegions as string[] | undefined) ?? [],
    complianceTags: (writeData.complianceTags as string[] | undefined) ?? [],
    capabilityTags: (writeData.capabilityTags as string[] | undefined) ?? [],
    inputModalities: (writeData.inputModalities as string[] | undefined) ?? [],
    outputModalities: (writeData.outputModalities as string[] | undefined) ?? [],
    domainMetadata: (writeData.domainMetadata as Prisma.InputJsonValue | null | undefined) ?? undefined,
  };

  const listing = await prisma.listing.create({
    data: createData,
  });

  // Return full DeployResult shape expected by the CLI
  const mcpToolName = `nexusx_${slug.replace(/-/g, "_")}`;
  return NextResponse.json({
    id: listing.id,
    slug: listing.slug,
    name: listing.name,
    listingUrl: `https://nexusx.dev/marketplace/${listing.slug}`,
    mcpToolName,
    floorPriceUsdc: Number(listing.floorPriceUsdc),
    ceilingPriceUsdc: listing.ceilingPriceUsdc ? Number(listing.ceilingPriceUsdc) : undefined,
  }, { status: 201 });
}
