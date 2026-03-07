import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getServerRedis } from "@/lib/serverRedis";
import {
  CIRCUIT_BREAKER_STATE_HASH_KEY,
  GATEWAY_LISTING_DEGRADATION_VERSION_KEY,
  getControlPlaneVersion,
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
  const [snapshot, routeVersion, degradationVersion, redis] = await Promise.all([
    getPlatformObservabilitySnapshot(prisma, { windowHours }),
    getControlPlaneVersion(prisma),
    getControlPlaneVersion(prisma, GATEWAY_LISTING_DEGRADATION_VERSION_KEY),
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

  if (redis) {
    try {
      const rawStates = await redis.hgetall(CIRCUIT_BREAKER_STATE_HASH_KEY);
      const parsedStates = Object.fromEntries(
        Object.entries(rawStates)
          .map(([slug, raw]) => [slug, parseSharedCircuitState(raw)])
          .filter((entry): entry is [string, NonNullable<ReturnType<typeof parseSharedCircuitState>>] => Boolean(entry[1])),
      );

      circuitBreakers = {
        backend: "redis",
        ...summarizeSharedCircuitStates(parsedStates),
      };
    } catch {
      circuitBreakers = {
        backend: "error",
        totalTracked: 0,
        totalOpen: 0,
        totalHalfOpen: 0,
        items: [],
      };
    }
  }

  return NextResponse.json({
    ...snapshot,
    controlPlane: {
      routeVersion,
      degradationVersion,
    },
    circuitBreakers,
  });
}
