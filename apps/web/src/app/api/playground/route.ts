import { NextRequest, NextResponse } from "next/server";
import { buildExecutableListingWhere, combineListingWhere } from "@nexusx/database";
import { prisma } from "@/lib/prisma";
import { assertSafeHttpUrl, safeFetch } from "@/lib/ssrf";


// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "x-payment",
  "x-nexusx-sandbox",
  "x-nexusx-key",
  "x-nexusx-request-id",
  "x-nexusx-bundle-session-id",
  "x-nexusx-bundle-step-index",
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "server",
  "x-powered-by",
]);

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }

  const body = await req.json();
  const { url, method, headers, body: requestBody } = body as {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };

  if (!url || !method) {
    return NextResponse.json(
      { error: "url and method are required" },
      { status: 400 }
    );
  }

  // Validate URL against known listing baseUrl or sandboxUrl
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    await assertSafeHttpUrl(parsedUrl.toString());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unsafe URL" },
      { status: 400 },
    );
  }

  const origin = parsedUrl.origin;
  const matchingListing = await prisma.listing.findFirst({
    where: combineListingWhere(
      buildExecutableListingWhere(),
      {
        OR: [
          { baseUrl: { startsWith: origin } },
          { sandboxUrl: { startsWith: origin } },
        ],
      },
    ),
    select: { id: true },
  });

  if (!matchingListing) {
    return NextResponse.json(
      { error: "URL does not match any known listing endpoint. Only registered API URLs are allowed in sandbox mode." },
      { status: 403 }
    );
  }

  // Proxy the request
  const startTime = Date.now();
  try {
    const sanitizedHeaders = Object.fromEntries(
      Object.entries(headers || {}).filter(([key]) => !STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())),
    );
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: sanitizedHeaders,
    };

    if (requestBody && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = requestBody;
    }

    const response = await safeFetch(url, fetchOptions, { maxRedirects: 2 });
    const responseTimeMs = Date.now() - startTime;
    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    return NextResponse.json({
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
      responseTimeMs,
    });
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({
      status: 0,
      headers: {},
      body: `Error: ${message}`,
      responseTimeMs,
    });
  }
}
