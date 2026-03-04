import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import { isPrivateHost } from "@/lib/ssrf";


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

  // Validate baseUrl — block private/internal addresses (SSRF prevention)
  try {
    const parsed = new URL(body.baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "baseUrl must use HTTP or HTTPS" }, { status: 400 });
    }
    if (isPrivateHost(parsed.hostname)) {
      return NextResponse.json({ error: "baseUrl cannot point to private/internal addresses" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "baseUrl is not a valid URL" }, { status: 400 });
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
      categoryId,
      slug,
      name: body.name,
      description: body.description || "",
      listingType: body.listingType || "REST_API",
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
