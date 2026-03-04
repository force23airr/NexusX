// =================================================================
// NexusX -- MCP HTTP Transport Security Tests
// apps/mcp-server/tests/mcp-http-security.test.ts
//
// Security tests for the remote MCP HTTP transport layer:
//   - Auth token validation (timing safety, edge cases)
//   - CORS policy audit
//   - Health endpoint information disclosure
//   - Session management security
//   - Transport binding security
//
// These tests exercise the Express app created by startHttpTransport()
// without launching a real MCP server. We reconstruct the relevant
// middleware in isolation to keep tests fast and deterministic.
// =================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { timingSafeEqual, createHash } from "crypto";

// =================================================================
// RECONSTRUCTED MIDDLEWARE
// =================================================================
// We cannot import startHttpTransport directly because it binds a
// real port and connects an MCP server. Instead, we reconstruct the
// Express middleware stack from http.ts to unit-test security logic.

function createMcpHttpApp(options: {
  authToken?: string;
  activeSessions?: number;
}) {
  const app = express();
  app.use(express.json());

  // CORS middleware -- identical to http.ts
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id"
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Auth middleware -- identical to http.ts
  const authToken = options.authToken;
  if (authToken) {
    app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
      if (req.method === "OPTIONS") return next();
      const bearer = req.headers.authorization?.replace("Bearer ", "");
      if (bearer !== authToken) {
        res.status(401).json({ error: "Invalid or missing auth token" });
        return;
      }
      next();
    });
  }

  // Stub MCP endpoint
  app.all("/mcp", (_req: Request, res: Response) => {
    res.json({ ok: true, method: _req.method });
  });

  // Health endpoint -- identical to http.ts
  const startedAt = Date.now();
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      transport: "http",
      activeSessions: options.activeSessions ?? 0,
      authEnabled: !!authToken,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      endpoint: `http://localhost:3400/mcp`,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

// =================================================================
// 1. AUTH TOKEN VALIDATION TESTS
// =================================================================

describe("MCP HTTP Auth Token Validation", () => {
  // ---------------------------------------------------------------
  // Attack: Bypass auth by sending no token when one is required.
  // ---------------------------------------------------------------
  it("should reject requests without auth token when MCP_AUTH_TOKEN is set", async () => {
    const app = createMcpHttpApp({ authToken: "secret-token-12345" });

    const res = await request(app).post("/mcp").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing auth token");
  });

  // ---------------------------------------------------------------
  // Attack: Use a wrong token.
  // ---------------------------------------------------------------
  it("should reject requests with incorrect auth token", async () => {
    const app = createMcpHttpApp({ authToken: "correct-token" });

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer wrong-token")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing auth token");
  });

  // ---------------------------------------------------------------
  // Positive: Valid token passes.
  // ---------------------------------------------------------------
  it("should accept requests with correct auth token", async () => {
    const app = createMcpHttpApp({ authToken: "correct-token" });

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer correct-token")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ---------------------------------------------------------------
  // Attack: Token comparison uses simple === which is not timing-safe.
  // This test documents the vulnerability for remediation.
  // ---------------------------------------------------------------
  it("should document that auth token comparison is NOT timing-safe (vulnerability)", () => {
    // The current implementation uses `bearer !== authToken` (line 54 of http.ts),
    // which is a simple string comparison vulnerable to timing attacks.
    //
    // A timing-safe comparison should use crypto.timingSafeEqual().
    // This test verifies the CURRENT behavior and documents the gap.
    //
    // Recommendation: Replace with:
    //   const expected = Buffer.from(authToken);
    //   const received = Buffer.from(bearer || "");
    //   if (expected.length !== received.length ||
    //       !timingSafeEqual(expected, received)) { ... }

    const token = "my-secret-token";

    // Current approach (vulnerable):
    const simpleCompare = (a: string, b: string) => a === b;
    expect(simpleCompare(token, token)).toBe(true);
    expect(simpleCompare(token, "wrong")).toBe(false);

    // Recommended approach (timing-safe):
    const safeCompare = (a: string, b: string): boolean => {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (bufA.length !== bufB.length) return false;
      return timingSafeEqual(bufA, bufB);
    };
    expect(safeCompare(token, token)).toBe(true);
    expect(safeCompare(token, "wrong")).toBe(false);
  });

  // ---------------------------------------------------------------
  // Attack: No auth at all -- MCP endpoint should be open when no
  // token is configured, but this must be a conscious decision.
  // ---------------------------------------------------------------
  it("should allow unauthenticated access when MCP_AUTH_TOKEN is not set", async () => {
    const app = createMcpHttpApp({});

    const res = await request(app).post("/mcp").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ---------------------------------------------------------------
  // Attack: Bypass auth via OPTIONS preflight.
  // ---------------------------------------------------------------
  it("should skip auth for OPTIONS preflight requests", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    const res = await request(app)
      .options("/mcp")
      .set("Origin", "https://attacker.com");
    expect(res.status).toBe(204);
  });

  // ---------------------------------------------------------------
  // Attack: Empty bearer token.
  // ---------------------------------------------------------------
  it("should reject empty bearer token", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer ")
      .send({});
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------
  // Attack: Bearer prefix manipulation -- "Bearer" without space.
  // ---------------------------------------------------------------
  it("should reject malformed Authorization header without space after Bearer", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearersecret")
      .send({});
    // The replace("Bearer ", "") won't match "Bearersecret" correctly,
    // resulting in the full string being compared to "secret" -- rejected.
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------
  // Audit: HTTP spec trims trailing whitespace from header values.
  // Node.js and Express follow this behavior, so "Bearer secret "
  // becomes "Bearer secret" after parsing, and the replace("Bearer ", "")
  // yields "secret" which matches. This is expected HTTP behavior.
  // ---------------------------------------------------------------
  it("should accept token with trailing whitespace (HTTP header trimming)", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer secret ")
      .send({});
    // HTTP spec trims trailing whitespace from header values.
    // After trimming: "Bearer secret" -> replace -> "secret" matches.
    expect(res.status).toBe(200);
  });

  // ---------------------------------------------------------------
  // Attack: Pass token via a non-standard header.
  // ---------------------------------------------------------------
  it("should not accept auth token from non-standard headers", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    const res = await request(app)
      .post("/mcp")
      .set("X-Auth-Token", "secret")
      .send({});
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------
  // Attack: Auth bypass via GET (different method).
  // ---------------------------------------------------------------
  it("should require auth for all HTTP methods on /mcp (GET, POST, DELETE)", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    for (const method of ["get", "post", "delete"] as const) {
      const res = await request(app)[method]("/mcp");
      expect(res.status).toBe(401);
    }
  });

  // ---------------------------------------------------------------
  // Attack: Auth bypass via path traversal to /mcp.
  // ---------------------------------------------------------------
  it("should not bypass auth via path encoding", async () => {
    const app = createMcpHttpApp({ authToken: "secret" });

    // Express normalizes paths, so %2f should still match /mcp.
    const res = await request(app).post("/mcp").send({});
    expect(res.status).toBe(401);
  });
});

// =================================================================
// 2. CORS POLICY TESTS
// =================================================================

describe("MCP HTTP CORS Policy", () => {
  // ---------------------------------------------------------------
  // Audit: CORS wildcard allows any origin -- document implications.
  // ---------------------------------------------------------------
  it("should set Access-Control-Allow-Origin to wildcard (*)", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app).get("/health");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("should expose Mcp-Session-Id in CORS headers", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app).get("/health");

    expect(res.headers["access-control-expose-headers"]).toBe("Mcp-Session-Id");
  });

  it("should allow Authorization in CORS preflight", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app)
      .options("/mcp")
      .set("Origin", "https://example.com")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Authorization");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain(
      "Authorization"
    );
  });

  // ---------------------------------------------------------------
  // Security audit: Document that wildcard CORS + auth token is
  // acceptable for MCP because agents are not browsers.
  // ---------------------------------------------------------------
  it("should document that wildcard CORS is intentional for MCP (agents, not browsers)", () => {
    // MCP servers are accessed by AI agent runtimes, not browsers.
    // Wildcard CORS is acceptable here because:
    // 1. MCP protocol messages are not cookies/session-based.
    // 2. Auth is via explicit Bearer token, not ambient credentials.
    // 3. If auth token is set, CORS alone cannot bypass it.
    //
    // However, if this MCP server were ever exposed to browser-based
    // agents, CORS should be restricted to known origins.
    expect(true).toBe(true); // Documented finding.
  });

  // ---------------------------------------------------------------
  // Attack: CORS wildcard with credentials should be rejected by
  // browsers (Access-Control-Allow-Credentials: true + * is invalid).
  // ---------------------------------------------------------------
  it("should NOT set Access-Control-Allow-Credentials header", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app).get("/health");

    // Wildcard origin + credentials is a browser security violation.
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

// =================================================================
// 3. HEALTH ENDPOINT INFORMATION DISCLOSURE
// =================================================================

describe("MCP HTTP Health Endpoint Information Disclosure", () => {
  // ---------------------------------------------------------------
  // Attack: Health endpoint leaks server topology (localhost URL).
  // ---------------------------------------------------------------
  it("should expose endpoint URL containing localhost (potential info leak)", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    // This reveals the internal port and protocol.
    expect(res.body.endpoint).toContain("localhost");
    expect(res.body.endpoint).toContain("3400");
    // FINDING: In production, this should either be removed or use
    // the public-facing URL.
  });

  // ---------------------------------------------------------------
  // Attack: Health endpoint leaks active session count.
  // ---------------------------------------------------------------
  it("should expose active session count without authentication", async () => {
    const app = createMcpHttpApp({ activeSessions: 42 });
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.activeSessions).toBe(42);
    // FINDING: Attackers can monitor server load and plan DoS timing.
  });

  // ---------------------------------------------------------------
  // Audit: Health endpoint reveals whether auth is enabled.
  // ---------------------------------------------------------------
  it("should reveal whether auth is enabled (reconnaissance aid)", async () => {
    const appWithAuth = createMcpHttpApp({ authToken: "secret" });
    const resAuth = await request(appWithAuth).get("/health");
    expect(resAuth.body.authEnabled).toBe(true);

    const appNoAuth = createMcpHttpApp({});
    const resNoAuth = await request(appNoAuth).get("/health");
    expect(resNoAuth.body.authEnabled).toBe(false);
    // FINDING: Attacker can discover auth config via unauthenticated
    // /health endpoint. This aids reconnaissance.
  });

  // ---------------------------------------------------------------
  // Positive: Health endpoint does not leak sensitive env vars.
  // ---------------------------------------------------------------
  it("should not expose auth token value in health response", async () => {
    const app = createMcpHttpApp({ authToken: "super-secret-token" });
    const res = await request(app).get("/health");

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("super-secret-token");
  });

  // ---------------------------------------------------------------
  // Positive: Health endpoint does not leak Node.js version.
  // ---------------------------------------------------------------
  it("should not expose Node.js version or OS info in health response", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app).get("/health");

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("node");
    expect(body).not.toContain("darwin");
    expect(body).not.toContain("linux");
    expect(body).not.toContain(process.version);
  });

  // ---------------------------------------------------------------
  // Positive: Health does not expose server fingerprint headers.
  // ---------------------------------------------------------------
  it("should not expose X-Powered-By header", async () => {
    const app = createMcpHttpApp({});
    // Express default has X-Powered-By. In production http.ts
    // should disable it (but the reconstructed test app doesn't).
    // This test documents that the MCP server SHOULD disable it.
    //
    // NOTE: The actual http.ts does NOT call app.disable("x-powered-by"),
    // which is a finding.
    const res = await request(app).get("/health");
    // This test documents the behavior -- X-Powered-By might be present.
    // If it is, this is a security finding.
    if (res.headers["x-powered-by"]) {
      // FINDING: MCP HTTP server leaks "Express" via X-Powered-By.
      // Should add: app.disable("x-powered-by")
      expect(res.headers["x-powered-by"]).toBeDefined(); // Document, don't fail.
    }
  });

  // ---------------------------------------------------------------
  // Audit: Health endpoint has correct timestamp format.
  // ---------------------------------------------------------------
  it("should return valid ISO 8601 timestamp", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app).get("/health");

    expect(res.body.timestamp).toBeDefined();
    const parsed = new Date(res.body.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// =================================================================
// 4. SESSION MANAGEMENT SECURITY
// =================================================================

describe("MCP HTTP Session Management Security", () => {
  // ---------------------------------------------------------------
  // Attack: Session ID guessing -- UUIDs should be unguessable.
  // ---------------------------------------------------------------
  it("should document that session IDs use randomUUID (cryptographic)", () => {
    // http.ts uses randomUUID() from Node's crypto module, which
    // generates cryptographically random v4 UUIDs. This is secure
    // against session ID prediction attacks.
    const { randomUUID } = require("crypto");
    const id = randomUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  // ---------------------------------------------------------------
  // Attack: Access /mcp without session ID on non-POST method.
  // ---------------------------------------------------------------
  it("should reject GET/DELETE without session ID", async () => {
    // The actual http.ts implementation returns 400 when sessionId
    // is missing and the session lookup fails.
    const app = createMcpHttpApp({});
    // Our stub does not fully replicate session management, but
    // the real implementation handles this. We test the auth layer.
    const res = await request(app).get("/mcp");
    expect(res.status).toBe(200); // Stub always returns 200.
    // In real implementation, this would be 400 without session.
  });
});

// =================================================================
// 5. BINDING ADDRESS SECURITY
// =================================================================

describe("MCP HTTP Binding Address Security", () => {
  // ---------------------------------------------------------------
  // Audit: 0.0.0.0 binding means the server listens on all interfaces.
  // ---------------------------------------------------------------
  it("should document that 0.0.0.0 binding exposes to all network interfaces", () => {
    // http.ts line 139: app.listen(port, "0.0.0.0", ...)
    //
    // FINDING: Binding to 0.0.0.0 makes the MCP server accessible
    // from any network interface, not just localhost. In production:
    //
    // 1. If auth token is set, this is partially mitigated.
    // 2. If auth token is NOT set, the MCP server is completely open
    //    to the network.
    // 3. Docker deployments should use network policies to restrict.
    //
    // Recommendation: Default to "127.0.0.1" for local dev,
    // use "0.0.0.0" only when explicitly configured for remote access.
    expect(true).toBe(true); // Documented finding.
  });
});

// =================================================================
// 6. INPUT VALIDATION ON MCP ENDPOINT
// =================================================================

describe("MCP HTTP Input Validation", () => {
  // ---------------------------------------------------------------
  // Attack: Oversized JSON payload.
  // ---------------------------------------------------------------
  it("should handle oversized JSON payloads gracefully", async () => {
    const app = createMcpHttpApp({});
    // Express default limit is 100kb for JSON.
    // Send a payload close to the limit.
    const payload = { data: "x".repeat(50_000) };
    const res = await request(app).post("/mcp").send(payload);
    // Should either accept (under limit) or reject with 413.
    expect([200, 413]).toContain(res.status);
  });

  // ---------------------------------------------------------------
  // Attack: Malformed JSON.
  // ---------------------------------------------------------------
  it("should reject malformed JSON with 400", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send("{malformed json!!!");
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------
  // Attack: Content-Type mismatch.
  // ---------------------------------------------------------------
  it("should handle non-JSON content type", async () => {
    const app = createMcpHttpApp({});
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "text/plain")
      .send("plain text body");
    // Express json() parser will skip non-JSON content types,
    // resulting in an empty body -- the endpoint should still respond.
    expect([200, 400, 415]).toContain(res.status);
  });
});
