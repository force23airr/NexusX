import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────
// POST /api/provider/listings/[listingId]/health
// Probe the listing's health check endpoint.
// ─────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;

  const result = await getCurrentProvider();
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

  // Determine health check URL
  const healthUrl = listing.healthCheckUrl || `${listing.baseUrl}/health`;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const ok = res.status >= 200 && res.status < 300;

    return NextResponse.json({
      ok,
      statusCode: res.status,
      latencyMs,
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json({
      ok: false,
      statusCode: 0,
      latencyMs,
      error: message.includes("abort")
        ? "Health check timed out (5s)"
        : `Connection failed: ${message}`,
    });
  }
}
