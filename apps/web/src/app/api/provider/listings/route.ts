import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = 20;

  const result = await getCurrentProvider();
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

  // Validate required fields
  const required = ["name", "description", "listingType", "categoryId", "baseUrl", "floorPriceUsdc"];
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json(
        { error: `Missing required field: ${field}` },
        { status: 400 }
      );
    }
  }

  const result = await getCurrentProvider();
  if (!result) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
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
  const schemaSpec = body.videoUrl ? { videoUrl: body.videoUrl } : undefined;

  // Merge user tags with sector tags (sector:value convention for filtering)
  const tags: string[] = body.tags || [];
  const sectors: string[] = body.sectors || [];
  for (const s of sectors) {
    tags.push(`sector:${s}`);
  }

  const listing = await prisma.listing.create({
    data: {
      providerId: result.user.id,
      categoryId: body.categoryId,
      slug,
      name: body.name,
      description: body.description,
      listingType: body.listingType,
      status: "DRAFT",
      baseUrl: body.baseUrl,
      healthCheckUrl: body.healthCheckUrl || null,
      docsUrl: body.docsUrl || null,
      sandboxUrl: body.sandboxUrl || null,
      authType: body.authType || "api_key",
      floorPriceUsdc: body.floorPriceUsdc,
      ceilingPriceUsdc: body.ceilingPriceUsdc || null,
      currentPriceUsdc: body.floorPriceUsdc,
      capacityPerMinute: body.capacityPerMinute || 60,
      isUnique: body.isUnique || false,
      tags,
      intents: Array.isArray(body.intents) ? body.intents : [],
      sampleRequest: body.sampleRequest || undefined,
      sampleResponse: body.sampleResponse || undefined,
      schemaSpec: schemaSpec || undefined,
    },
  });

  return NextResponse.json({ id: listing.id, slug: listing.slug }, { status: 201 });
}
