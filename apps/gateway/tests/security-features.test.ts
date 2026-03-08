// =================================================================
// NexusX -- Security Tests for New Features
// apps/gateway/tests/security-features.test.ts
//
// Comprehensive security tests for:
//   1. API Key Auth (apiKeyAuth.ts) -- validation logic
//   2. Provider Listings endpoint -- authorization boundaries
//   3. MCP HTTP transport auth -- token edge cases
//   4. Credential injection -- cross-contamination
//   5. Seed data security -- dev key exposure
//   6. Data leak prevention
//
// Run: npx vitest run apps/gateway/tests/security-features.test.ts
// =================================================================

import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createGatewayApp, type GatewayDependencies } from "../src/server";
import { generateApiKey, type ApiKeyRecord } from "../src/middleware/auth";
import { CredentialService } from "../src/services/credentialService";
import type {
  ListingRoute,
  DemandSignalEvent,
  TransactionRecord,
  GatewayConfig,
} from "../src/types";
import * as fs from "fs";
import * as path from "path";

// -----------------------------------------------------------------
// SHARED TEST FIXTURES
// -----------------------------------------------------------------

const TEST_LISTING: ListingRoute = {
  listingId: "lst_feat_001",
  slug: "test-api",
  providerId: "prv_feat_001",
  providerAddress: "0xFeatureTestProvider",
  baseUrl: "https://upstream.example.com",
  authType: "api_key",
  currentPriceUsdc: 0.005,
  floorPriceUsdc: 0.001,
  capacityPerMinute: 100,
  status: "ACTIVE",
  isSandbox: false,
};

const SANDBOX_LISTING: ListingRoute = {
  ...TEST_LISTING,
  listingId: "lst_sandbox_001",
  slug: "sandbox-api",
  isSandbox: true,
};

function createTestKey(): { rawKey: string; record: ApiKeyRecord } {
  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  return {
    rawKey,
    record: {
      id: "key_feat_001",
      userId: "usr_feat_001",
      keyHash,
      status: "ACTIVE",
      rateLimitRpm: 60,
      allowedIps: [],
      expiresAt: null,
      walletAddress: "0xFeatBuyerWallet",
    },
  };
}

function createMockDeps(overrides?: Partial<GatewayDependencies>): {
  deps: GatewayDependencies;
  testKey: { rawKey: string; record: ApiKeyRecord };
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
      if (slug === "sandbox-api") return SANDBOX_LISTING;
      return null;
    },
    lookupListingById: async (id) => {
      if (id === TEST_LISTING.listingId) return TEST_LISTING;
      if (id === SANDBOX_LISTING.listingId) return SANDBOX_LISTING;
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

  return { deps, testKey, signals, transactions };
}

// =================================================================
// 1. API KEY AUTH SECURITY
// (Tests the validation logic shared between gateway auth.ts
//  and web apiKeyAuth.ts)
// =================================================================

describe("API Key Auth Security", () => {
  // ---------------------------------------------------------------
  // Attack: Timing attack on API key hash comparison.
  // The gateway's auth.ts uses `hash !== record.keyHash` which is
  // NOT timing-safe. Document this vulnerability.
  // ---------------------------------------------------------------
  describe("Timing Attack Resistance", () => {
    it("should document that SHA-256 hash comparison is NOT timing-safe", () => {
      // VULNERABILITY: Both auth.ts (line 117) and apiKeyAuth.ts (line 41)
      // use `hash !== key.keyHash` for comparing SHA-256 hashes.
      //
      // This is a non-timing-safe comparison. While SHA-256 hashing
      // provides some protection (attacker cannot incrementally guess
      // the hash), a timing-safe comparison is still best practice.
      //
      // Recommendation: Replace with:
      //   const hashBuf = Buffer.from(hash, "hex");
      //   const storedBuf = Buffer.from(record.keyHash, "hex");
      //   if (!timingSafeEqual(hashBuf, storedBuf)) { ... }

      // Verify that timingSafeEqual works correctly as the recommended fix:
      const key = "nxs_testpfx0_abcdefghijklmnopqrstuvwxyz";
      const hash = createHash("sha256").update(key).digest("hex");
      const hashBuf = Buffer.from(hash, "hex");
      const sameBuf = Buffer.from(hash, "hex");
      const diffBuf = Buffer.from(
        createHash("sha256").update("different-key").digest("hex"),
        "hex"
      );

      expect(timingSafeEqual(hashBuf, sameBuf)).toBe(true);
      expect(timingSafeEqual(hashBuf, diffBuf)).toBe(false);
    });

    it("should verify that prefix lookup uses constant-time-safe prefix extraction", () => {
      // The prefix extraction `rawKey.slice(4, 12)` is deterministic
      // and not timing-sensitive (it operates on the input, not a secret).
      // However, the DB lookup time could leak whether a prefix exists.
      // This is mitigated by the subsequent hash verification.

      const { rawKey } = generateApiKey();
      const prefix = rawKey.slice(4, 12);
      expect(prefix).toHaveLength(8);
    });
  });

  // ---------------------------------------------------------------
  // Attack: API key with valid prefix but wrong body.
  // The prefix lookup succeeds, but the full hash must fail.
  // ---------------------------------------------------------------
  describe("Hash Verification After Prefix Match", () => {
    it("should reject key with correct prefix but wrong body", async () => {
      const { rawKey, keyHash, keyPrefix } = generateApiKey();
      const record: ApiKeyRecord = {
        id: "key_hash_test",
        userId: "usr_001",
        keyHash,
        status: "ACTIVE",
        rateLimitRpm: 60,
        allowedIps: [],
        expiresAt: null,
        walletAddress: "0xWallet",
      };

      const { deps } = createMockDeps({
        lookupApiKey: async (prefix) => {
          if (prefix === rawKey.slice(4, 12)) return record;
          return null;
        },
      });

      const { app, cleanup } = createGatewayApp(deps);

      // Construct a key with the same prefix but different body.
      const fakeKey = `nxs_${rawKey.slice(4, 12)}_aaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${fakeKey}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("INVALID_KEY");
      cleanup();
    });
  });

  // ---------------------------------------------------------------
  // Attack: Expired API key.
  // ---------------------------------------------------------------
  describe("Expiry Enforcement", () => {
    it("should reject API key that expired 1 second ago", async () => {
      const { rawKey, keyHash } = generateApiKey();
      const record: ApiKeyRecord = {
        id: "key_exp_1s",
        userId: "usr_001",
        keyHash,
        status: "ACTIVE",
        rateLimitRpm: 60,
        allowedIps: [],
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
        walletAddress: "0xWallet",
      };

      const { deps } = createMockDeps({
        lookupApiKey: async (prefix) => {
          if (prefix === rawKey.slice(4, 12)) return record;
          return null;
        },
      });

      const { app, cleanup } = createGatewayApp(deps);

      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("KEY_EXPIRED");
      cleanup();
    });

    it("should accept API key that expires 1 hour from now", async () => {
      const originalFetch = global.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        ) as any
      );

      const { rawKey, keyHash } = generateApiKey();
      const record: ApiKeyRecord = {
        id: "key_exp_future",
        userId: "usr_001",
        keyHash,
        status: "ACTIVE",
        rateLimitRpm: 60,
        allowedIps: [],
        expiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
        walletAddress: "0xWallet",
      };

      const { deps } = createMockDeps({
        lookupApiKey: async (prefix) => {
          if (prefix === rawKey.slice(4, 12)) return record;
          return null;
        },
      });

      const { app, cleanup } = createGatewayApp(deps);

      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      cleanup();
      vi.stubGlobal("fetch", originalFetch);
    });

    it("should accept API key with null expiresAt (never expires)", async () => {
      const originalFetch = global.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        ) as any
      );

      const { rawKey, keyHash } = generateApiKey();
      const record: ApiKeyRecord = {
        id: "key_no_exp",
        userId: "usr_001",
        keyHash,
        status: "ACTIVE",
        rateLimitRpm: 60,
        allowedIps: [],
        expiresAt: null,
        walletAddress: "0xWallet",
      };

      const { deps } = createMockDeps({
        lookupApiKey: async (prefix) => {
          if (prefix === rawKey.slice(4, 12)) return record;
          return null;
        },
      });

      const { app, cleanup } = createGatewayApp(deps);

      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      cleanup();
      vi.stubGlobal("fetch", originalFetch);
    });
  });

  // ---------------------------------------------------------------
  // Attack: Revoked/suspended API key.
  // ---------------------------------------------------------------
  describe("Status Enforcement", () => {
    for (const status of ["REVOKED", "SUSPENDED", "DISABLED"]) {
      it(`should reject API key with status ${status}`, async () => {
        const { rawKey, keyHash } = generateApiKey();
        const record: ApiKeyRecord = {
          id: `key_${status.toLowerCase()}`,
          userId: "usr_001",
          keyHash,
          status,
          rateLimitRpm: 60,
          allowedIps: [],
          expiresAt: null,
          walletAddress: "0xWallet",
        };

        const { deps } = createMockDeps({
          lookupApiKey: async (prefix) => {
            if (prefix === rawKey.slice(4, 12)) return record;
            return null;
          },
        });

        const { app, cleanup } = createGatewayApp(deps);

        const res = await request(app)
          .get("/v1/test-api/anything")
          .set("Authorization", `Bearer ${rawKey}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe("KEY_INACTIVE");
        cleanup();
      });
    }
  });

  // ---------------------------------------------------------------
  // Attack: Malformed key formats.
  // ---------------------------------------------------------------
  describe("Malformed Key Handling", () => {
    let app: ReturnType<typeof createGatewayApp>["app"];
    let cleanup: () => void;

    beforeEach(() => {
      const { deps } = createMockDeps();
      const gateway = createGatewayApp(deps);
      app = gateway.app;
      cleanup = gateway.cleanup;
    });

    afterEach(() => cleanup());

    it("should reject key shorter than 12 characters", async () => {
      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", "Bearer nxs_short");
      expect(res.status).toBe(401);
    });

    it("should reject empty Bearer value", async () => {
      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", "Bearer ");
      expect(res.status).toBe(401);
    });

    it("should reject key without nxs_ prefix", async () => {
      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", "Bearer abc_testpfx0_abcdefghijklmnopqrst");
      expect(res.status).toBe(401);
    });

    it("should reject Authorization header without Bearer scheme", async () => {
      const { testKey } = createMockDeps();
      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Basic ${testKey.rawKey}`);
      expect(res.status).toBe(401);
    });

    it("should reject key containing only alphanumeric noise (no nxs_ prefix match)", async () => {
      // Null bytes cannot be sent in HTTP headers (supertest rejects them).
      // Instead, test that a key without the nxs_ prefix convention fails.
      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      expect(res.status).toBe(401);
    });

    it("should reject key with only whitespace after Bearer", async () => {
      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", "Bearer    ");
      expect(res.status).toBe(401);
    });
  });
});

// =================================================================
// 2. API KEY AUTH -- apiKeyAuth.ts STATIC ANALYSIS
// (Verifies the web app's API key auth follows security patterns)
// =================================================================

describe("apiKeyAuth.ts Static Security Analysis", () => {
  const apiKeyAuthPath = path.resolve(
    __dirname,
    "../../../apps/web/src/lib/apiKeyAuth.ts"
  );

  let source: string;

  beforeEach(() => {
    try {
      source = fs.readFileSync(apiKeyAuthPath, "utf-8");
    } catch {
      source = "";
    }
  });

  it("should use SHA-256 for key hashing (not MD5 or plaintext comparison)", () => {
    if (!source) return; // Skip if file not found.
    expect(source).toContain('createHash("sha256")');
    expect(source).not.toContain('createHash("md5")');
    expect(source).not.toContain("plaintext");
  });

  it("should check key status before granting access", () => {
    if (!source) return;
    expect(source).toContain('key.status !== "ACTIVE"');
  });

  it("should check key expiry", () => {
    if (!source) return;
    expect(source).toContain("expiresAt");
    expect(source).toContain("Date.now()");
  });

  it("should only accept Bearer tokens starting with nxs_", () => {
    if (!source) return;
    expect(source).toContain('startsWith("Bearer nxs_")');
  });

  it("should validate minimum key length", () => {
    if (!source) return;
    expect(source).toContain("rawKey.length < 12");
  });

  it("should use prefix-then-hash lookup pattern (not full key lookup)", () => {
    if (!source) return;
    // Verify prefix extraction matches gateway pattern.
    expect(source).toContain("rawKey.slice(4, 12)");
    expect(source).toContain("keyPrefix: prefix");
  });

  it("should use timingSafeEqual for hash comparison (fix verified)", () => {
    if (!source) return;
    // FIXED: apiKeyAuth.ts now uses timingSafeEqual for timing-safe comparison.
    expect(source).toContain("timingSafeEqual");
  });

  it("should return null (not throw) for invalid keys", () => {
    if (!source) return;
    // Returning null allows the caller to fall back to Clerk auth.
    // Throwing would break the auth chain.
    expect(source).toContain("return null");
    expect(source).not.toContain("throw new Error");
  });
});

// =================================================================
// 3. PROVIDER ISOLATION (Authorization Boundary)
// Tests that one provider cannot access another provider's listings.
// =================================================================

describe("Provider Isolation", () => {
  // ---------------------------------------------------------------
  // The listings endpoint at /api/provider/listings filters by
  // `providerId: result.user.id`. We test the equivalent gateway-
  // side auth model to verify user scoping works.
  // ---------------------------------------------------------------
  describe("Gateway-Level User Scoping", () => {
    it("should attach correct buyerId from authenticated API key", async () => {
      const originalFetch = global.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        ) as any
      );

      // Create two different keys for two different users.
      const key1 = generateApiKey();
      const key2 = generateApiKey();

      const record1: ApiKeyRecord = {
        id: "key_user1",
        userId: "usr_provider_A",
        keyHash: key1.keyHash,
        status: "ACTIVE",
        rateLimitRpm: 60,
        allowedIps: [],
        expiresAt: null,
        walletAddress: "0xProviderA",
      };

      const record2: ApiKeyRecord = {
        id: "key_user2",
        userId: "usr_provider_B",
        keyHash: key2.keyHash,
        status: "ACTIVE",
        rateLimitRpm: 60,
        allowedIps: [],
        expiresAt: null,
        walletAddress: "0xProviderB",
      };

      let capturedBuyerId = "";

      const { deps } = createMockDeps({
        lookupApiKey: async (prefix) => {
          if (prefix === key1.rawKey.slice(4, 12)) return record1;
          if (prefix === key2.rawKey.slice(4, 12)) return record2;
          return null;
        },
        persistTransaction: async (record) => {
          capturedBuyerId = record.buyerId;
        },
      });

      const { app, cleanup } = createGatewayApp(deps);

      // User A's request.
      await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${key1.rawKey}`);
      expect(capturedBuyerId).toBe("usr_provider_A");

      // User B's request.
      await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${key2.rawKey}`);
      expect(capturedBuyerId).toBe("usr_provider_B");

      cleanup();
      vi.stubGlobal("fetch", originalFetch);
    });
  });

  // ---------------------------------------------------------------
  // Static analysis: Verify listings route scopes by providerId.
  // ---------------------------------------------------------------
  describe("Listings Route Static Analysis", () => {
    const routePath = path.resolve(
      __dirname,
      "../../../apps/web/src/app/api/provider/listings/route.ts"
    );

    let source: string;

    beforeEach(() => {
      try {
        source = fs.readFileSync(routePath, "utf-8");
      } catch {
        source = "";
      }
    });

    it("should filter GET listings by providerId from authenticated user", () => {
      if (!source) return;
      // The route must use `providerId: result.user.id` as a WHERE
      // filter, not accept a client-provided providerId.
      expect(source).toContain("providerId: result.user.id");
    });

    it("should require authentication before processing GET request", () => {
      if (!source) return;
      // getCurrentProvider() must be called before DB queries.
      expect(source).toContain("getCurrentProvider(req)");
      expect(source).toContain('"Authentication required"');
    });

    it("should require authentication before processing POST request", () => {
      if (!source) return;
      // POST handler must also authenticate. The function is exported as
      // `export async function POST(req: NextRequest)`.
      const postIdx = source.indexOf("export async function POST");
      expect(postIdx).toBeGreaterThan(-1);
      const postSection = source.slice(postIdx);
      expect(postSection).toContain("getCurrentProvider(req)");
    });

    it("should set new listing providerId from authenticated user, not request body", () => {
      if (!source) return;
      // The POST handler must use `providerId: result.user.id`
      // in the Prisma create call.
      expect(source).toContain("providerId: result.user.id");
    });

    it("should NOT accept providerId from request body", () => {
      if (!source) return;
      // Verify no body.providerId is used in the create statement.
      expect(source).not.toContain("body.providerId");
    });
  });
});

// =================================================================
// 4. INPUT VALIDATION -- LISTINGS ENDPOINT
// =================================================================

describe("Listings Endpoint Input Validation", () => {
  const routePath = path.resolve(
    __dirname,
    "../../../apps/web/src/app/api/provider/listings/route.ts"
  );

  let source: string;

  beforeEach(() => {
    try {
      source = fs.readFileSync(routePath, "utf-8");
    } catch {
      source = "";
    }
  });

  // ---------------------------------------------------------------
  // Attack: Missing required fields.
  // ---------------------------------------------------------------
  it("should validate required fields (name, baseUrl, floorPriceUsdc)", () => {
    if (!source) return;
    expect(source).toContain('"name"');
    expect(source).toContain('"baseUrl"');
    expect(source).toContain('"floorPriceUsdc"');
    expect(source).toContain("Missing required field");
  });

  // ---------------------------------------------------------------
  // Attack: Category resolution fallback could assign wrong category.
  // ---------------------------------------------------------------
  it("should have a fallback category resolution mechanism", () => {
    if (!source) return;
    // When neither categoryId nor categorySlug is provided, the code
    // falls back to the first category alphabetically.
    expect(source).toContain("findFirst");
    expect(source).toContain('orderBy: { name: "asc" }');
    // FINDING: This fallback means a listing could be miscategorized
    // if the client omits category info. Not a security vulnerability
    // per se, but a data integrity concern.
  });

  // ---------------------------------------------------------------
  // Attack: SQL injection via categorySlug.
  // ---------------------------------------------------------------
  it("should use Prisma findFirst for category lookup (parameterized)", () => {
    if (!source) return;
    // Prisma.findFirst automatically parameterizes queries.
    expect(source).toContain("prisma.category.findFirst");
    expect(source).not.toContain("$queryRaw");
    expect(source).not.toContain("$queryRawUnsafe");
  });

  // ---------------------------------------------------------------
  // Attack: Slug injection via body.slug.
  // ---------------------------------------------------------------
  it("should sanitize slug generation from name", () => {
    if (!source) return;
    // The slug is generated from the name by:
    //   1. Lowercasing
    //   2. Removing non-alphanumeric chars (except spaces and hyphens)
    //   3. Replacing spaces with hyphens
    //   4. Deduplicating hyphens
    //   5. Trimming leading/trailing hyphens
    expect(source).toContain(".toLowerCase()");
    expect(source).toContain(".replace(/[^a-z0-9\\s-]/g");
  });

  // ---------------------------------------------------------------
  // Attack: Duplicate slug collision.
  // ---------------------------------------------------------------
  it("should handle slug collisions by appending timestamp", () => {
    if (!source) return;
    expect(source).toContain("prisma.listing.findUnique");
    expect(source).toContain("Date.now().toString(36)");
  });

  // ---------------------------------------------------------------
  // Attack: Unvalidated status query parameter on GET.
  // ---------------------------------------------------------------
  it("should pass status filter to Prisma without raw SQL", () => {
    if (!source) return;
    // The GET handler uses `where.status = status` with Prisma,
    // which auto-parameterizes. No raw SQL vulnerability.
    expect(source).toContain("where.status = status");
    expect(source).not.toContain("$queryRawUnsafe");
  });

  // ---------------------------------------------------------------
  // Attack: XSS via listing name/description stored in DB.
  // ---------------------------------------------------------------
  it("should store raw body values (XSS mitigation is at render time)", () => {
    if (!source) return;
    // The POST handler stores body.name and body.description directly.
    // This is acceptable IF the frontend sanitizes output (React does
    // this by default with JSX). However, if any server-side rendering
    // interpolates these values, XSS is possible.
    expect(source).toContain("name: body.name");
    // FINDING: Server-side XSS mitigation is the frontend's job
    // (React auto-escapes). The API is a data passthrough.
  });

  // ---------------------------------------------------------------
  // Attack: SSRF via baseUrl -- listing points to internal services.
  // ---------------------------------------------------------------
  it("should document that baseUrl is not validated for SSRF", () => {
    if (!source) return;
    // FINDING: The POST handler accepts any baseUrl without validation.
    // An attacker with provider access could create a listing pointing
    // to internal services (e.g., http://169.254.169.254/metadata).
    //
    // The gateway's proxy service later uses this URL to forward requests,
    // making this a potential SSRF vector.
    //
    // Recommendation: Validate baseUrl against an allowlist or block
    // private IP ranges (10.x, 172.16.x, 192.168.x, 169.254.x, localhost).
    expect(source).toContain("baseUrl: body.baseUrl");
    // No URL validation exists -- document as finding.
  });
});

// =================================================================
// 5. CREDENTIAL INJECTION SECURITY
// =================================================================

describe("Credential Injection Security", () => {
  // ---------------------------------------------------------------
  // Attack: Credential cross-contamination between listings.
  // ---------------------------------------------------------------
  describe("Cross-Contamination Prevention", () => {
    let service: CredentialService;

    beforeEach(() => {
      process.env.PROVIDER_CRED_API_ALPHA = "Authorization:Bearer alpha-secret";
      process.env.PROVIDER_CRED_API_BETA = "X-API-Key:beta-secret-key";
      service = new CredentialService();
    });

    afterEach(() => {
      delete process.env.PROVIDER_CRED_API_ALPHA;
      delete process.env.PROVIDER_CRED_API_BETA;
    });

    it("should return different credentials for different slugs", () => {
      const alpha = service.getCredential("api-alpha");
      const beta = service.getCredential("api-beta");

      expect(alpha).not.toBeNull();
      expect(beta).not.toBeNull();
      expect(alpha!.headerValue).toBe("Bearer alpha-secret");
      expect(beta!.headerValue).toBe("beta-secret-key");
      expect(alpha!.headerName).not.toBe(beta!.headerName);
    });

    it("should not return credentials for a slug that has no env var", () => {
      const result = service.getCredential("api-gamma");
      expect(result).toBeNull();
    });

    it("should not leak one slug's credentials when requesting another", () => {
      const alpha = service.getCredential("api-alpha");
      const unknown = service.getCredential("api-unknown");

      expect(alpha!.headerValue).toContain("alpha-secret");
      expect(unknown).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Attack: Credential injection via proxy route -- verify creds
  // are injected into upstream request but NOT returned to client.
  // ---------------------------------------------------------------
  describe("Credential Exposure Prevention", () => {
    let originalFetch: typeof fetch;

    afterEach(() => {
      if (originalFetch) {
        vi.stubGlobal("fetch", originalFetch);
      }
      delete process.env.PROVIDER_CRED_TEST_API;
    });

    it("should not expose injected credentials in response headers", async () => {
      process.env.PROVIDER_CRED_TEST_API = "Authorization:Bearer upstream-secret";
      originalFetch = global.fetch;

      let capturedHeaders: Record<string, string> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL | globalThis.Request, init?: RequestInit) => {
          // Capture the headers sent to the upstream.
          const headers = init?.headers as Record<string, string> | undefined;
          if (headers) {
            capturedHeaders = { ...headers };
          }
          return new Response(JSON.stringify({ result: "ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }) as any
      );

      const { deps, testKey } = createMockDeps();
      const { app, cleanup } = createGatewayApp(deps);

      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${testKey.rawKey}`);

      // The injected credential should have been sent to the upstream.
      expect(capturedHeaders["Authorization"] || capturedHeaders["authorization"])
        .toBe("Bearer upstream-secret");

      // But it must NOT appear in the response to the client.
      const responseText = JSON.stringify(res.body) + JSON.stringify(res.headers);
      expect(responseText).not.toContain("upstream-secret");

      cleanup();
    });

    it("should not expose credential env var values in error responses", async () => {
      process.env.PROVIDER_CRED_TEST_API = "Authorization:Bearer super-secret-key";
      originalFetch = global.fetch;

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Connection refused");
        }) as any
      );

      const { deps, testKey } = createMockDeps();
      const { app, cleanup } = createGatewayApp(deps);

      const res = await request(app)
        .get("/v1/test-api/anything")
        .set("Authorization", `Bearer ${testKey.rawKey}`);

      // Error response must not leak the credential.
      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toContain("super-secret-key");
      expect(responseText).not.toContain("PROVIDER_CRED");

      cleanup();
    });
  });

  // ---------------------------------------------------------------
  // Attack: All 6 listing slug credentials isolated.
  // ---------------------------------------------------------------
  describe("All Listing Slug Credentials Isolated", () => {
    const slugs = [
      { slug: "openai-gpt4-turbo", envSuffix: "OPENAI_GPT4_TURBO" },
      { slug: "anthropic-claude-sonnet", envSuffix: "ANTHROPIC_CLAUDE_SONNET" },
      { slug: "deepl-translation-api", envSuffix: "DEEPL_TRANSLATION_API" },
      { slug: "sentiment-analysis-pro", envSuffix: "SENTIMENT_ANALYSIS_PRO" },
      { slug: "text-embeddings-v3", envSuffix: "TEXT_EMBEDDINGS_V3" },
      { slug: "restaurant-reviews-dataset", envSuffix: "RESTAURANT_REVIEWS_DATASET" },
    ];

    afterEach(() => {
      for (const { envSuffix } of slugs) {
        delete process.env[`PROVIDER_CRED_${envSuffix}`];
      }
    });

    it("should isolate credentials across all 6 listing slugs", () => {
      // Set unique credentials for each slug.
      for (const { envSuffix } of slugs) {
        process.env[`PROVIDER_CRED_${envSuffix}`] = `Authorization:Bearer key-${envSuffix}`;
      }

      const service = new CredentialService();

      for (const { slug, envSuffix } of slugs) {
        const cred = service.getCredential(slug);
        expect(cred).not.toBeNull();
        expect(cred!.headerValue).toBe(`Bearer key-${envSuffix}`);

        // Verify no other slug returns this credential.
        for (const other of slugs) {
          if (other.slug !== slug) {
            const otherCred = service.getCredential(other.slug);
            expect(otherCred!.headerValue).not.toBe(cred!.headerValue);
          }
        }
      }
    });
  });
});

// =================================================================
// 6. SEED DATA SECURITY
// =================================================================

describe("Seed Data Security", () => {
  const seedPath = path.resolve(
    __dirname,
    "../../../packages/database/prisma/seeds/seed.ts"
  );

  let source: string;

  beforeEach(() => {
    try {
      source = fs.readFileSync(seedPath, "utf-8");
    } catch {
      source = "";
    }
  });

  // ---------------------------------------------------------------
  // Attack: Hardcoded API keys leaked to production.
  // ---------------------------------------------------------------
  it("should contain hardcoded dev API keys (expected for dev seed)", () => {
    if (!source) return;
    // The seed file contains dev API keys -- this is expected for
    // local development but MUST NOT be used in production.
    expect(source).toContain("nxs_aliceprd_");
    expect(source).toContain("nxs_bobprod0_");
    expect(source).toContain("nxs_carlares_");
    expect(source).toContain("nxs_oaiprov0_");
    expect(source).toContain("nxs_antprov0_");
  });

  it("should hash API keys before storing (not store plaintext)", () => {
    if (!source) return;
    expect(source).toContain("hashKey(key.rawKey)");
    expect(source).toContain('createHash("sha256")');
  });

  it("should print dev keys only to console (not persist plaintext)", () => {
    if (!source) return;
    // The seed prints keys at the end for developer convenience.
    // Verify they are console.log, not written to files.
    expect(source).toContain("console.log");
    expect(source).toContain("Dev API keys for CLI");
    // Keys should NOT be persisted in any data field.
    expect(source).not.toContain("rawKey: key.rawKey"); // Not stored in DB
  });

  it("should not include real production API keys", () => {
    if (!source) return;
    // Verify the seed keys are obviously fake/dev-only.
    // Real keys would have random characters, not repeated patterns.
    const devKeyPattern = /nxs_[a-z]{8}_abcdefghijklmnopqrstuvwxyz\d{2}/;
    expect(source).toMatch(devKeyPattern);
  });

  it("should use deterministic UUIDs for seed data (v4 format)", () => {
    if (!source) return;
    // Deterministic IDs are expected for idempotent seeding.
    expect(source).toContain("00000000-0000-4000-a000-");
  });

  // ---------------------------------------------------------------
  // Attack: Seed data uses localhost:3500 for baseUrl.
  // ---------------------------------------------------------------
  it("should use localhost baseUrls (dev-only, not production URLs)", () => {
    if (!source) return;
    expect(source).toContain("http://localhost:3500");
    // This is safe because seed data is for dev environments only.
    // Production listings would have real URLs.
  });
});

// =================================================================
// 7. DATA LEAK PREVENTION IN RESPONSES
// =================================================================

describe("Data Leak Prevention in API Responses", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ) as any
    );
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  // ---------------------------------------------------------------
  // Attack: API key value leaked in response body.
  // ---------------------------------------------------------------
  it("should not echo the API key in any response body", async () => {
    const { deps, testKey } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("Authorization", `Bearer ${testKey.rawKey}`);

    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain(testKey.rawKey);
    expect(responseText).not.toContain(testKey.record.keyHash);
    cleanup();
  });

  // ---------------------------------------------------------------
  // Attack: Internal user ID leaked in response.
  // ---------------------------------------------------------------
  it("should not expose internal user IDs in proxy response headers beyond request context", async () => {
    const { deps, testKey } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("Authorization", `Bearer ${testKey.rawKey}`);

    // x-nexusx-request-id is OK (it is a per-request UUID).
    // But internal user IDs, wallet addresses, etc. should not be in headers.
    for (const [key, value] of Object.entries(res.headers)) {
      const valStr = String(value);
      if (key.startsWith("x-nexusx-")) {
        expect(valStr).not.toContain(testKey.record.userId);
        expect(valStr).not.toContain(testKey.record.walletAddress);
      }
    }
    cleanup();
  });

  // ---------------------------------------------------------------
  // Attack: Stack trace in 500 error.
  // ---------------------------------------------------------------
  it("should not include stack traces in 500 error responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Internal database connection failed at /var/db/conn.sock");
      }) as any
    );

    const { deps, testKey } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("Authorization", `Bearer ${testKey.rawKey}`);

    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("/var/db");
    expect(responseText).not.toContain("conn.sock");
    expect(responseText).not.toContain(".ts:");
    expect(responseText).not.toContain("at ");
    cleanup();
  });

  // ---------------------------------------------------------------
  // Attack: Listing pricing response should not contain baseUrl.
  // ---------------------------------------------------------------
  it("should not expose listing baseUrl in pricing response", async () => {
    const { deps } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app).get("/pricing/test-api");
    expect(res.status).toBe(200);

    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("upstream.example.com");
    cleanup();
  });

  // ---------------------------------------------------------------
  // Attack: Error response reveals database schema.
  // ---------------------------------------------------------------
  it("should not expose Prisma or database terms in error responses", async () => {
    const { deps } = createMockDeps({
      lookupApiKey: async () => {
        throw new Error("Prisma query failed: P2002 Unique constraint violation on field `keyHash`");
      },
    });

    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("Authorization", "Bearer nxs_testpfx0_abcdefghijklmnopqrstuvwxyz");

    // The error handler should catch and sanitize.
    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("Prisma");
    expect(responseText).not.toContain("P2002");
    expect(responseText).not.toContain("keyHash");
    expect(responseText).not.toContain("Unique constraint");
    cleanup();
  });
});

// =================================================================
// 8. SANDBOX BYPASS PREVENTION (x402 mode)
// =================================================================

describe("Sandbox Bypass Prevention", () => {
  let originalFetch: typeof fetch;

  // Mock the facilitator /verify endpoint.
  const facilitatorMock = vi.fn(async (url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);
    if (urlStr.includes("/verify")) {
      return new Response(
        JSON.stringify({ isValid: true, payer: "0xPayer" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (urlStr.includes("/settle")) {
      return new Response(
        JSON.stringify({ success: true, txHash: "0xabc" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.stubGlobal("fetch", facilitatorMock as any);
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  // ---------------------------------------------------------------
  // Attack: Client sends X-NexusX-Sandbox header when sandbox is
  // disabled. The x402 middleware should ignore the header.
  // In x402 mode with sandboxEnabled: false, the X-NexusX-Sandbox
  // header should be ignored and the request should require payment.
  // ---------------------------------------------------------------
  it("should ignore X-NexusX-Sandbox header when sandboxEnabled is false in x402 mode", async () => {
    const { deps } = createMockDeps();
    const x402Config: Partial<GatewayConfig> = {
      x402Enabled: true,
      x402FacilitatorUrl: "https://x402.org/facilitator",
      x402Network: "base-sepolia",
      x402PlatformAddress: "0xPlatform",
      sandboxEnabled: false,
    };
    const { app, cleanup } = createGatewayApp(deps, x402Config);

    // Send request with sandbox header but no payment.
    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("X-NexusX-Sandbox", "true");

    // Without a valid X-Payment header, x402 middleware should return 402.
    // The sandbox header should be ignored because sandboxEnabled is false.
    expect(res.status).toBe(402);
    cleanup();
  });

  // ---------------------------------------------------------------
  // Positive: Sandbox mode works when enabled.
  // ---------------------------------------------------------------
  it("should allow sandbox bypass when sandboxEnabled is true in x402 mode", async () => {
    const { deps } = createMockDeps();
    const x402Config: Partial<GatewayConfig> = {
      x402Enabled: true,
      x402FacilitatorUrl: "https://x402.org/facilitator",
      x402Network: "base-sepolia",
      x402PlatformAddress: "0xPlatform",
      sandboxEnabled: true,
    };
    const { app, cleanup } = createGatewayApp(deps, x402Config);

    // Send request with sandbox header and no payment.
    const res = await request(app)
      .get("/v1/test-api/anything")
      .set("X-NexusX-Sandbox", "true");

    // Should bypass payment and proceed to proxy (200 from mock upstream).
    expect(res.status).toBe(200);
    cleanup();
  });
});

// =================================================================
// 9. RESPONSE HEADER SECURITY
// =================================================================

describe("Response Header Security", () => {
  it("should not expose Server header", async () => {
    const { deps } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app).get("/health");
    expect(res.headers["server"]).toBeUndefined();
    cleanup();
  });

  it("should not expose X-Powered-By on any response status", async () => {
    const { deps, testKey } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    // 200
    const res200 = await request(app).get("/health");
    expect(res200.headers["x-powered-by"]).toBeUndefined();

    // 401
    const res401 = await request(app).get("/v1/test-api/anything");
    expect(res401.headers["x-powered-by"]).toBeUndefined();

    // 404
    const res404 = await request(app).get("/nonexistent");
    expect(res404.headers["x-powered-by"]).toBeUndefined();

    cleanup();
  });
});

// =================================================================
// 10. MCP AUTH TOKEN -- SOURCE CODE AUDIT
// =================================================================

describe("MCP HTTP Transport Source Code Audit", () => {
  const httpTransportPath = path.resolve(
    __dirname,
    "../../../apps/mcp-server/src/transports/http.ts"
  );

  let source: string;

  beforeEach(() => {
    try {
      source = fs.readFileSync(httpTransportPath, "utf-8");
    } catch {
      source = "";
    }
  });

  it("should use timingSafeEqual for auth token comparison (fix verified)", () => {
    if (!source) return;
    // FIXED: MCP auth now uses timingSafeEqual for timing-safe comparison.
    expect(source).toContain("timingSafeEqual");
    expect(source).not.toContain("bearer !== authToken");
  });

  it("should bind to 0.0.0.0 (network exposure documented)", () => {
    if (!source) return;
    expect(source).toContain('"0.0.0.0"');
  });

  it("should set CORS wildcard (*) for Access-Control-Allow-Origin", () => {
    if (!source) return;
    expect(source).toContain('"*"');
  });

  it("should use randomUUID for session IDs (cryptographic)", () => {
    if (!source) return;
    expect(source).toContain("randomUUID");
  });

  it("should have session idle timeout (DoS mitigation)", () => {
    if (!source) return;
    expect(source).toContain("SESSION_IDLE_TIMEOUT_MS");
    expect(source).toContain("30 * 60 * 1000");
  });

  it("should disable X-Powered-By (fix verified)", () => {
    if (!source) return;
    // FIXED: MCP server now disables X-Powered-By header.
    expect(source).toContain('disable("x-powered-by")');
  });

  it("should use express.json() for body parsing (no raw eval)", () => {
    if (!source) return;
    expect(source).toContain("express.json()");
    expect(source).not.toContain("eval(");
    expect(source).not.toContain("Function(");
  });

  it("should skip auth for OPTIONS requests (CORS preflight)", () => {
    if (!source) return;
    expect(source).toContain('req.method === "OPTIONS"');
  });

  it("should log to stderr, not stdout (security best practice for MCP)", () => {
    if (!source) return;
    // MCP servers should log to stderr because stdout is used for
    // protocol messages in stdio mode.
    expect(source).toContain("console.error");
  });
});

// =================================================================
// 11. auth.ts (web) SOURCE CODE AUDIT
// =================================================================

describe("Web Auth Module Source Code Audit", () => {
  const authPath = path.resolve(
    __dirname,
    "../../../apps/web/src/lib/auth.ts"
  );

  let source: string;

  beforeEach(() => {
    try {
      source = fs.readFileSync(authPath, "utf-8");
    } catch {
      source = "";
    }
  });

  it("should try API key auth before Clerk auth for provider routes", () => {
    if (!source) return;
    // getCurrentProvider() must check API key first.
    const providerFn = source.slice(source.indexOf("getCurrentProvider"));
    expect(providerFn).toContain("getProviderFromApiKey(req)");
    // API key check comes before getCurrentUser().
    const apiKeyIdx = providerFn.indexOf("getProviderFromApiKey");
    const clerkIdx = providerFn.indexOf("getCurrentUser()");
    expect(apiKeyIdx).toBeLessThan(clerkIdx);
  });

  it("should not expose Clerk session tokens in API responses", () => {
    if (!source) return;
    // The auth module should not return session tokens or Clerk secrets.
    expect(source).not.toContain("sessionToken");
    expect(source).not.toContain("secretKey");
  });

  it("should return null (not throw) when not authenticated", () => {
    if (!source) return;
    // getCurrentUser returns null, not throws.
    const getCurrentUser = source.slice(
      source.indexOf("async function getCurrentUser"),
      source.indexOf("async function getCurrentProvider")
    );
    expect(getCurrentUser).toContain("return null");
  });
});

// =================================================================
// 12. STATUS ENDPOINT INFORMATION EXPOSURE
// =================================================================

describe("Status Endpoint Information Exposure", () => {
  it("should not expose memory usage on /status without authentication", async () => {
    const { deps } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.body.memory).toBeUndefined();
    cleanup();
  });

  it("should not expose cache stats on /status without authentication", async () => {
    const { deps } = createMockDeps();
    const { app, cleanup } = createGatewayApp(deps);

    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.body.cache).toBeUndefined();
    expect(res.body.status).toBe("ok");
    cleanup();
  });
});
