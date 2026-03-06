// ═══════════════════════════════════════════════════════════════
// NexusX — Demand Gap Tracker
// packages/database/src/demand-gap-tracker.ts
//
// Tracks search intents that returned no results or low
// confidence matches. Surfaces unmet demand to providers
// and gives new listings a temporary boost when they fill gaps.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient, DemandGap } from "@prisma/client";

const MAX_SAMPLE_QUERIES = 10;

/**
 * Record an unmet demand from a search query.
 * Called when a search returns no results or very low confidence.
 */
export async function recordUnmetDemand(
  prisma: PrismaClient,
  query: string,
  intent: string,
  confidence: number,
  matchCount: number,
): Promise<void> {
  if (!intent || intent.trim().length === 0) return;

  const normalized = intent.toLowerCase().trim();

  // Upsert by intent cluster
  const existing = await prisma.demandGap.findFirst({
    where: { intentCluster: normalized, isResolved: false },
  });

  if (existing) {
    // Update existing gap
    const sampleQueries = existing.sampleQueries.length < MAX_SAMPLE_QUERIES
      ? [...existing.sampleQueries, query]
      : existing.sampleQueries;

    await prisma.demandGap.update({
      where: { id: existing.id },
      data: {
        queryCount: { increment: 1 },
        avgConfidence: (Number(existing.avgConfidence) * existing.queryCount + confidence)
          / (existing.queryCount + 1),
        sampleQueries,
        lastSeenAt: new Date(),
      },
    });
  } else {
    // Create new gap
    await prisma.demandGap.create({
      data: {
        intentCluster: normalized,
        sampleQueries: [query],
        queryCount: 1,
        avgConfidence: confidence,
      },
    });
  }
}

/**
 * Get top unresolved demand gaps, sorted by frequency.
 */
export async function getTopDemandGaps(
  prisma: PrismaClient,
  limit: number = 20,
): Promise<DemandGap[]> {
  return prisma.demandGap.findMany({
    where: { isResolved: false },
    orderBy: { queryCount: "desc" },
    take: limit,
  });
}

/**
 * Check if a newly activated listing resolves any demand gap.
 * Matches listing intents, tags, and name against gap intent clusters.
 */
export async function checkDemandGapMatch(
  prisma: PrismaClient,
  listingId: string,
): Promise<DemandGap | null> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      name: true,
      tags: true,
      intents: true,
      category: { select: { slug: true } },
    },
  });

  if (!listing) return null;

  // Build a set of keywords from the listing
  const keywords = [
    ...listing.tags.map((t) => t.toLowerCase()),
    ...listing.intents.map((i) => i.toLowerCase()),
    listing.category.slug,
    ...listing.name.toLowerCase().split(/\s+/),
  ].filter((k) => k.length >= 3);

  if (keywords.length === 0) return null;

  // Find unresolved gaps that match any keyword
  const gaps = await prisma.demandGap.findMany({
    where: { isResolved: false },
    orderBy: { queryCount: "desc" },
    take: 50,
  });

  for (const gap of gaps) {
    const clusterTokens = gap.intentCluster.split(/[\s-_]+/);
    const hasMatch = clusterTokens.some((ct) =>
      keywords.some((kw) => kw.includes(ct) || ct.includes(kw)),
    );

    if (hasMatch) {
      // Mark gap as resolved
      await prisma.demandGap.update({
        where: { id: gap.id },
        data: {
          isResolved: true,
          resolvedByListingId: listingId,
        },
      });
      return gap;
    }
  }

  return null;
}
