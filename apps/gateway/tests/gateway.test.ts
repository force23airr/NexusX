// ═══════════════════════════════════════════════════════════════
// NexusX — Gateway Tests
// apps/gateway/tests/gateway.test.ts
//
// Unit and integration tests for the API gateway.
// Uses the factory functions directly without needing a
// running server — tests Express middleware and services.
// ═══════════════════════════════════════════════════════════════

import { createHash, randomUUID } from "crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createGatewayApp, type GatewayDependencies } from "../src/server";
import { generateApiKey, type ApiKeyRecord } from "../src/middleware/auth";
import { RateLimiter } from "../src/middleware/rateLimiter";
import { BillingService } from "../src/services/billingService";
import { RouteResolver } from "../src/services/routeResolver";
import type {
  ListingRoute,
  DemandSignalEvent,
  TransactionRecord,
} from "../src/types";

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_LISTING: ListingRoute = {
  listingId: "lst_001",
  providerId: "prv_001",
  providerAddress: "0xProviderWallet",
  baseUrl: "https://httpbin.org",
  authType: "api_key",
  currentPriceUsdc: 0.005,
  floorPriceUsdc: 0.001,
  capacityPerMinute: 100,
  status: "ACTIVE",
  isSandbox: false,
};

function createTestKey(): { rawKey: string; record: ApiKeyRecord } {
  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  return {
    rawKey,
    record: {
      id: "key_001",
      userId: "usr_001",
      keyHash,
      status: "ACTIVE",
      rateLimitRpm: 60,
      allowedIps: [],
      expiresAt: null,
      walletAddress: "0xBuyerWallet",
    },
  };
}

function createMockDeps(overrides?: Partial<GatewayDependencies>): {
  deps: GatewayDependencies;
  signals: DemandSignalEvent[];
  transactions: TransactionRecord[];
} {
  const signals: DemandSignalEvent[] = [];
  const transactions: TransactionRecord[] = [];
  const testKey = createTestKey();

  const deps: GatewayDependencies = {
    lookupApiKey: async (prefix) => {
      if (prefix === testKey.rawKey.slice(4, 12)) {
        return testKey.record;
      }
      return null;
    },
    touchApiKey: async () => {},
    lookupListingBySlug: async (slug) => {
      if (slug === "test-api") return TEST_LISTING;
      return null;
    },
    lookupListingById: async (id) => {
      if (id === TEST_LISTING.listingId) return TEST_LISTING;
      return null;
    },
    persistTransaction: async (record) => {
      transactions.push(record);
    },
    emitDemandSignal: (signal) => {
      signals.push(signal);
    },
    ...overrides,
  };

  return { deps, signals, transactions };
}

// ─────────────────────────────────────────────────────────────
// API KEY GENERATION
// ─────────────────────────────────────────────────────────────

describe("API Key Generation", () => {
  it("generates key with correct format", () => {
    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    expect(rawKey).toMatch(/^nxs_[a-z0-9]{8}_[a-z0-9]{28}$/);
    expect(keyPrefix).toHaveLength(8);
    expect(keyHash).toHaveLength(64); // SHA-256 hex

    // Verify hash matches.
    const computed = createHash("sha256").update(rawKey).digest("hex");
    expect(computed).toBe(keyHash);
  });

  it("generates unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { rawKey } = generateApiKey();
      expect(keys.has(rawKey)).toBe(false);
      keys.add(rawKey);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// RATE LIMITER (UNIT)
// ─────────────────────────────────────────────────────────────

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
  });

  it("allows requests within limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = limiter.check("key1", 10);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests exceeding limit", () => {
    for (let i = 0; i < 10; i++) {
      limiter.check("key1", 10);
    }
    const result = limiter.check("key1", 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks separate keys independently", () => {
    for (let i = 0; i < 10; i++) {
      limiter.check("key1", 10);
    }

    // key1 is exhausted.
    expect(limiter.check("key1", 10).allowed).toBe(false);

    // key2 is fresh.
    expect(limiter.check("key2", 10).allowed).toBe(true);
  });

  it("reports correct remaining count", () => {
    const result1 = limiter.check("key1", 5);
    expect(result1.remaining).toBe(4);

    const result2 = limiter.check("key1", 5);
    expect(result2.remaining).toBe(3);
  });

  it("provides retry-after when blocked", () => {
    for (let i = 0; i < 10; i++) {
      limiter.check("key1", 10);
    }
    const result = limiter.check("key1", 10);
    expect(result.allowed).toBe(false);
    expect(result.resetMs).toBeGreaterThan(0);
    expect(result.resetMs).toBeLessThanOrEqual(60000);
  });
});

// ─────────────────────────────────────────────────────────────
// BILLING SERVICE (UNIT)
// ─────────────────────────────────────────────────────────────

describe("BillingService", () => {
  it("computes correct fee split at 12%", () => {
    const billing = new BillingService(
      async () => {},
      () => {},
      { platformFeeRate: 0.12 }
    );

    const split = billing.computeSplit(0.005);
    expect(split.price).toBe(0.005);
    expect(split.platformFee).toBe(0.0006);
    expect(split.providerAmount).toBe(0.0044);
    expect(split.feeRate).toBe(0.12);
  });

  it("handles zero price", () => {
    const billing = new BillingService(async () => {}, () => {});
    const split = billing.computeSplit(0);
    expect(split.platformFee).toBe(0);
    expect(split.providerAmount).toBe(0);
  });

  it("maintains precision with large amounts", () => {
    const billing = new BillingService(async () => {}, () => {});
    const split = billing.computeSplit(10000.0);

    // 12% of 10000 = 1200.
    expect(split.platformFee).toBe(1200);
    expect(split.providerAmount).toBe(8800);
    expect(split.platformFee + split.providerAmount).toBe(split.price);
  });

  it("rounds USDC to 6 decimal places", () => {
    const billing = new BillingService(async () => {}, () => {});

    // 0.12 * 0.000003 = 0.00000036 → rounds to 0.0
    expect(billing.roundUsdc(0.00000036)).toBe(0);

    // 0.12 * 0.000010 = 0.0000012 → rounds to 0.000001
    expect(billing.roundUsdc(0.0000015)).toBe(0.000002);
  });
});

// ─────────────────────────────────────────────────────────────
// ROUTE RESOLVER (UNIT)
// ─────────────────────────────────────────────────────────────

describe("RouteResolver", () => {
  let resolver: RouteResolver;
  let lookupCount: number;

  beforeEach(() => {
    lookupCount = 0;
    resolver = new RouteResolver(
      async (slug) => {
        lookupCount++;
        if (slug === "test-api") return TEST_LISTING;
        return null;
      },
      async (id) => {
        lookupCount++;
        if (id === TEST_LISTING.listingId) return TEST_LISTING;
        return null;
      },
      5000 // 5s TTL for tests
    );
  });

  afterEach(() => {
    resolver.destroy();
  });

  it("resolves existing listing", async () => {
    const route = await resolver.resolveBySlug("test-api");
    expect(route).not.toBeNull();
    expect(route!.listingId).toBe("lst_001");
  });

  it("returns null for unknown listing", async () => {
    const route = await resolver.resolveBySlug("nonexistent");
    expect(route).toBeNull();
  });

  it("caches resolved routes", async () => {
    await resolver.resolveBySlug("test-api");
    await resolver.resolveBySlug("test-api");
    await resolver.resolveBySlug("test-api");

    // Only one DB lookup despite three calls.
    expect(lookupCount).toBe(1);
  });

  it("invalidates cache", async () => {
    await resolver.resolveBySlug("test-api");
    resolver.invalidate("test-api");
    await resolver.resolveBySlug("test-api");

    // Two lookups: one before invalidation, one after.
    expect(lookupCount).toBe(2);
  });

  it("reports cache stats", () => {
    const stats = resolver.stats();
    expect(stats.ttlMs).toBe(5000);
    expect(stats.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// HEALTH ROUTES (INTEGRATION)
// ─────────────────────────────────────────────────────────────

describe("Health Routes", () => {
  let app: ReturnType<typeof createGatewayApp>["app"];
  let cleanup: () => void;

  beforeEach(() => {
    const { deps } = createMockDeps();
    const gateway = createGatewayApp(deps);
    app = gateway.app;
    cleanup = gateway.cleanup;
  });

  afterEach(() => cleanup());

  it("GET /health returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /ready returns 200 with uptime", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("GET /status returns gateway info", async () => {
    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("nexusx-gateway");
    expect(res.body.memory).toBeDefined();
    expect(res.body.cache).toBeDefined();
  });

  it("GET /pricing/:slug returns pricing info", async () => {
    const res = await request(app).get("/pricing/test-api");
    expect(res.status).toBe(200);
    expect(res.body.pricing.currentPriceUsdc).toBe("0.005000");
    expect(res.body.pricing.feeSplit).toBeDefined();
    expect(res.body.pricing.feeSplit.feeRate).toBe("12.0%");
  });

  it("GET /pricing/:unknown returns 404", async () => {
    const res = await request(app).get("/pricing/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE (INTEGRATION)
// ─────────────────────────────────────────────────────────────

describe("Auth Middleware", () => {
  let app: ReturnType<typeof createGatewayApp>["app"];
  let cleanup: () => void;

  beforeEach(() => {
    const { deps } = createMockDeps();
    const gateway = createGatewayApp(deps);
    app = gateway.app;
    cleanup = gateway.cleanup;
  });

  afterEach(() => cleanup());

  it("rejects requests without API key", async () => {
    const res = await request(app).get("/v1/test-api/anything");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("rejects invalid API key", async () => {
    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("Authorization", "Bearer nxs_invalid_keynotrealatall1234567890ab");
    expect(res.status).toBe(401);
  });

  it("rejects expired API key", async () => {
    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    const expiredRecord: ApiKeyRecord = {
      id: "key_expired",
      userId: "usr_001",
      keyHash,
      status: "ACTIVE",
      rateLimitRpm: 60,
      allowedIps: [],
      expiresAt: new Date(Date.now() - 86400000), // Yesterday.
      walletAddress: "0xBuyer",
    };

    const { deps } = createMockDeps({
      lookupApiKey: async (prefix) => {
        if (prefix === rawKey.slice(4, 12)) return expiredRecord;
        return null;
      },
    });

    const gateway = createGatewayApp(deps);
    const res = await request(gateway.app)
      .get("/v1/test-api/anything")
      .set("Authorization", `Bearer ${rawKey}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("KEY_EXPIRED");
    gateway.cleanup();
  });

  it("rejects revoked API key", async () => {
    const { rawKey, keyHash } = generateApiKey();
    const revokedRecord: ApiKeyRecord = {
      id: "key_revoked",
      userId: "usr_001",
      keyHash,
      status: "REVOKED",
      rateLimitRpm: 60,
      allowedIps: [],
      expiresAt: null,
      walletAddress: "0xBuyer",
    };

    const { deps } = createMockDeps({
      lookupApiKey: async (prefix) => {
        if (prefix === rawKey.slice(4, 12)) return revokedRecord;
        return null;
      },
    });

    const gateway = createGatewayApp(deps);
    const res = await request(gateway.app)
      .get("/v1/test-api/anything")
      .set("Authorization", `Bearer ${rawKey}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("KEY_INACTIVE");
    gateway.cleanup();
  });
});

// ─────────────────────────────────────────────────────────────
// CATCH-ALL
// ─────────────────────────────────────────────────────────────

describe("404 Handling", () => {
  it("returns 404 for unknown routes", async () => {
    const { deps } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app).get("/unknown/route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");

    cleanup();
  });
});
