import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/intents?q=translate
 *
 * Discover available intent capabilities across the marketplace.
 * Returns distinct intents from all active listings, optionally
 * filtered by a search query.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.toLowerCase().trim() || "";

  const listings = await prisma.listing.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      intents: true,
      category: { select: { slug: true, name: true } },
    },
  });

  // Collect distinct intents, optionally filtered
  const intentSet = new Map<string, { intent: string; listings: { slug: string; name: string; categorySlug: string }[] }>();

  for (const listing of listings) {
    for (const intent of listing.intents) {
      if (query && !intent.toLowerCase().includes(query)) continue;

      if (!intentSet.has(intent)) {
        intentSet.set(intent, { intent, listings: [] });
      }
      intentSet.get(intent)!.listings.push({
        slug: listing.slug,
        name: listing.name,
        categorySlug: listing.category.slug,
      });
    }
  }

  const results = Array.from(intentSet.values()).sort((a, b) =>
    a.intent.localeCompare(b.intent),
  );

  return NextResponse.json({
    intents: results.map((r) => r.intent),
    details: results,
    total: results.length,
  });
}
