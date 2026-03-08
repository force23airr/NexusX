import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getServerRedis } from "@/lib/serverRedis";
import {
  ABUSE_BLOCK_STATE_HASH_KEY,
  CIRCUIT_BREAKER_STATE_HASH_KEY,
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  GATEWAY_PRICING_VERSION_KEY,
  GATEWAY_ROUTE_VERSION_KEY,
  parseAbuseBlockState,
  summarizeAbuseBlockStates,
  getControlPlaneVersionMap,
  getPlatformObservabilitySnapshot,
  parseSharedCircuitState,
  summarizeSharedCircuitStates,
} from "@nexusx/database";

function parseWindowHours(value: string | null): number {
  const parsed = Number.parseInt(value || "24", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return Math.min(parsed, 24 * 30);
}

type CircuitBreakerBackend = "redis" | "unavailable" | "error";
type RateLimitBackend = "shared_redis" | "local_fallback" | "error";
type AbuseBackend = "redis" | "unavailable" | "error";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!user.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const windowHours = parseWindowHours(searchParams.get("windowHours"));
  const [snapshot, versions, redis] = await Promise.all([
    getPlatformObservabilitySnapshot(prisma, { windowHours }),
    getControlPlaneVersionMap(prisma, [
      GATEWAY_ROUTE_VERSION_KEY,
      GATEWAY_PRICING_VERSION_KEY,
      GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
    ]),
    getServerRedis(),
  ]);

  let circuitBreakers: {
    backend: CircuitBreakerBackend;
    totalTracked: number;
    totalOpen: number;
    totalHalfOpen: number;
    items: ReturnType<typeof summarizeSharedCircuitStates>["items"];
  } = {
    backend: "unavailable",
    totalTracked: 0,
    totalOpen: 0,
    totalHalfOpen: 0,
    items: [],
  };

  let rateLimiting: {
    backend: RateLimitBackend;
    status: "ok" | "warn" | "critical";
    message: string;
  } = {
    backend: "local_fallback",
    status: "warn",
    message: "Redis is unavailable. Gateway instances may fall back to local rate limiting.",
  };

  let abuseProtection: {
    backend: AbuseBackend;
    totalTracked: number;
    totalAuthBlocks: number;
    totalPaymentBlocks: number;
    items: ReturnType<typeof summarizeAbuseBlockStates>["items"];
  } = {
    backend: "unavailable",
    totalTracked: 0,
    totalAuthBlocks: 0,
    totalPaymentBlocks: 0,
    items: [],
  };

  if (redis) {
    try {
      const [rawStates, rawAbuseStates] = await Promise.all([
        redis.hgetall(CIRCUIT_BREAKER_STATE_HASH_KEY),
        redis.hgetall(ABUSE_BLOCK_STATE_HASH_KEY),
        redis.ping(),
      ]);
      const parsedStates = Object.fromEntries(
        Object.entries(rawStates)
          .map(([slug, raw]) => [slug, parseSharedCircuitState(raw)])
          .filter((entry): entry is [string, NonNullable<ReturnType<typeof parseSharedCircuitState>>] => Boolean(entry[1])),
      );
      const parsedAbuseStates = Object.fromEntries(
        Object.entries(rawAbuseStates)
          .map(([field, raw]) => [field, parseAbuseBlockState(raw)])
          .filter((entry): entry is [string, NonNullable<ReturnType<typeof parseAbuseBlockState>>] => Boolean(entry[1])),
      );

      circuitBreakers = {
        backend: "redis",
        ...summarizeSharedCircuitStates(parsedStates),
      };
      abuseProtection = {
        backend: "redis",
        ...summarizeAbuseBlockStates(parsedAbuseStates),
      };
      rateLimiting = {
        backend: "shared_redis",
        status: "ok",
        message: "Gateway rate limiting is backed by shared Redis state.",
      };
    } catch {
      circuitBreakers = {
        backend: "error",
        totalTracked: 0,
        totalOpen: 0,
        totalHalfOpen: 0,
        items: [],
      };
      abuseProtection = {
        backend: "error",
        totalTracked: 0,
        totalAuthBlocks: 0,
        totalPaymentBlocks: 0,
        items: [],
      };
      rateLimiting = {
        backend: "error",
        status: "critical",
        message: "Redis health check failed. Shared rate limiting cannot be trusted right now.",
      };
    }
  }

  return NextResponse.json({
    ...snapshot,
    controlPlane: {
      routeVersion: versions[GATEWAY_ROUTE_VERSION_KEY] ?? 0,
      pricingVersion: versions[GATEWAY_PRICING_VERSION_KEY] ?? 0,
      degradationVersion: versions[GATEWAY_LISTING_DEGRADATION_VERSION_KEY] ?? 0,
    },
    circuitBreakers,
    rateLimiting,
    abuseProtection,
  });
}
