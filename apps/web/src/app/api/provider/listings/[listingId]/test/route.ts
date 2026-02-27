import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentProvider } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────
// POST /api/provider/listings/[listingId]/test
// Send a sandbox test call through the gateway.
// ─────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3100";

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

  // Find an API key for this provider to authenticate with the gateway
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      userId: result.user.id,
      status: "ACTIVE",
    },
    select: { keyHash: true, keyPrefix: true },
  });

  // Build the test request
  const sampleBody = listing.sampleRequest || { text: "test" };
  const isGetRequest = listing.listingType === "DATASET";
  const testPath = isGetRequest
    ? `${GATEWAY_URL}/v1/${listing.slug}`
    : `${GATEWAY_URL}/v1/${listing.slug}`;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = {
      "X-NexusX-Sandbox": "true",
    };

    // Use the key prefix as auth (gateway matches on prefix)
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey.keyPrefix}_sandbox`;
    }

    const fetchOpts: RequestInit = {
      method: isGetRequest ? "GET" : "POST",
      headers,
      signal: controller.signal,
    };

    if (!isGetRequest) {
      headers["Content-Type"] = "application/json";
      fetchOpts.body = JSON.stringify(sampleBody);
    }

    const res = await fetch(testPath, fetchOpts);
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const ok = res.status >= 200 && res.status < 300;

    let responsePreview = "";
    try {
      const text = await res.text();
      responsePreview = text.length > 500 ? text.slice(0, 500) + "..." : text;
    } catch {
      responsePreview = "(could not read response body)";
    }

    return NextResponse.json({
      ok,
      statusCode: res.status,
      latencyMs,
      responsePreview,
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json({
      ok: false,
      statusCode: 0,
      latencyMs,
      responsePreview: "",
      error: message.includes("abort")
        ? "Test call timed out (10s)"
        : `Connection failed: ${message}`,
    });
  }
}
