import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

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

  const origin = parsedUrl.origin;
  const matchingListing = await prisma.listing.findFirst({
    where: {
      OR: [
        { baseUrl: { startsWith: origin } },
        { sandboxUrl: { startsWith: origin } },
      ],
      status: "ACTIVE",
    },
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
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: headers || {},
    };

    if (requestBody && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = requestBody;
    }

    const response = await fetch(url, fetchOptions);
    const responseTimeMs = Date.now() - startTime;
    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
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
