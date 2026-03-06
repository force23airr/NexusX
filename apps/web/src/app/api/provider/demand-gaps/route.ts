import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";
import { getTopDemandGaps } from "@nexusx/database";

// ─────────────────────────────────────────────────────────────
// GET /api/provider/demand-gaps?limit=20
// Returns top unresolved demand gaps sorted by query count.
// Shows providers what agents are searching for but not finding.
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const provider = await getCurrentProvider(req);
  if (!provider) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

  const gaps = await getTopDemandGaps(prisma, limit);

  return NextResponse.json({
    gaps: gaps.map((gap) => ({
      id: gap.id,
      intentCluster: gap.intentCluster,
      sampleQueries: gap.sampleQueries,
      queryCount: gap.queryCount,
      avgConfidence: Number(gap.avgConfidence),
      firstSeenAt: gap.firstSeenAt.toISOString(),
      lastSeenAt: gap.lastSeenAt.toISOString(),
    })),
    total: gaps.length,
  });
}
