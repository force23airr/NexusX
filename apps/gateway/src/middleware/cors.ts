// ═══════════════════════════════════════════════════════════════
// NexusX — CORS Middleware
// apps/gateway/src/middleware/cors.ts
//
// Sets permissive CORS headers for the public API gateway.
// Mounted as the very first middleware so OPTIONS preflights
// never reach auth or payment checks.
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

// Headers clients are allowed to send.
// Includes bundle session headers read by proxy.ts lines 119-120.
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-NexusX-Key",
  "X-Payment",
  "X-NexusX-Sandbox",
  "X-NexusX-Query-Id",
  "X-NexusX-Bundle-Session-Id",
  "X-NexusX-Bundle-Step-Index",
  "mcp-session-id",
].join(", ");

// Non-simple response headers browsers may read.
// Must match exactly what proxy.ts sets — see routes/proxy.ts lines 323-352.
const EXPOSED_HEADERS = [
  "X-NexusX-Request-Id",
  "X-NexusX-Receipt-Id",
  "X-NexusX-Receipt-Outcome",
  "X-NexusX-Listing",
  "X-NexusX-Query-Id",
  "X-NexusX-Auth-Mode",
  "X-NexusX-Latency-Ms",
  "X-NexusX-Billing-Mode",
  "X-NexusX-Price-USDC",
  "X-NexusX-Quoted-Price-USDC",
  "X-NexusX-Fee-USDC",
  "X-NexusX-Provider-Amount-USDC",
  "X-NexusX-Payment",
  "X-NexusX-Settlement-Status",
  "X-NexusX-TxHash",
  "X-NexusX-Circuit-State",
  "X-NexusX-Bundle-Quoted-Price-USDC",
  "X-NexusX-Bundle-Session-Id",
  "X-NexusX-Bundle-Step-Index",
  "X-NexusX-Sandbox",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
].join(", ");

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle preflight — return immediately, no auth/payment check
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
