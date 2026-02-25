// ═══════════════════════════════════════════════════════════════
// NexusX — Proxy Route Handler
// apps/gateway/src/routes/proxy.ts
//
// The hot path. Every API call flows through here:
//   Auth → Rate Limit → Resolve Route → Proxy → Bill → Respond
//
// URL pattern: /v1/:listingSlug/*
// Example:     /v1/openai-gpt4/chat/completions
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from "express";
import type { RequestContext, ListingRoute, DemandSignalEvent } from "../types";
import type { RouteResolver } from "../services/routeResolver";
import type { ProxyService } from "../services/proxyService";
import type { BillingService } from "../services/billingService";
import type { ReliabilityAggregator } from "../services/reliability-aggregator";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ProxyRouteConfig {
  routeResolver: RouteResolver;
  proxyService: ProxyService;
  billingService: BillingService;
  emitSignal: (signal: DemandSignalEvent) => void;
  /** When true, x402 handles billing — skip billingService.processCall(). */
  x402Enabled?: boolean;
  /** Records call results for real-time reliability scoring. */
  reliabilityAggregator?: ReliabilityAggregator;
}

// ─────────────────────────────────────────────────────────────
// ROUTE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Create the proxy route handler.
 *
 * Mounts on /v1/:listingSlug/* and proxies authenticated
 * requests to the upstream provider.
 */
export function createProxyRoute(config: ProxyRouteConfig): Router {
  const router = Router();
  const { routeResolver, proxyService, billingService, emitSignal } = config;

  // ─── Catch-all handler for all methods ───
  router.all("/v1/:listingSlug/*", handleProxy);
  router.all("/v1/:listingSlug", handleProxy);

  async function handleProxy(req: Request, res: Response): Promise<void> {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    const listingSlug = req.params.listingSlug as string;

    // ─── 1. Resolve listing route ───
    let route: ListingRoute | null;
    try {
      route = await routeResolver.resolveBySlug(listingSlug);
    } catch (err) {
      console.error("[Proxy] Route resolution error:", err);
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Failed to resolve listing.",
        requestId: ctx.requestId,
      });
      return;
    }

    if (!route) {
      res.status(404).json({
        error: "LISTING_NOT_FOUND",
        message: `No active listing found for slug: ${listingSlug}`,
        requestId: ctx.requestId,
      });
      return;
    }

    // ─── 2. Check listing status ───
    if (route.status !== "ACTIVE") {
      res.status(503).json({
        error: "LISTING_UNAVAILABLE",
        message: `Listing "${listingSlug}" is currently ${route.status.toLowerCase()}.`,
        requestId: ctx.requestId,
      });
      return;
    }

    // ─── 3. Determine sandbox mode ───
    const isSandbox = req.headers["x-nexusx-sandbox"] === "true";
    if (isSandbox) {
      route = { ...route, isSandbox: true };
    }

    // ─── 4. Extract upstream path ───
    // /v1/openai-gpt4/chat/completions → /chat/completions
    const fullPath = req.params[0] || "";
    const upstreamPath = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
    const queryString = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?") + 1)
      : "";

    // ─── 5. Collect request body ───
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;

    // ─── 6. Proxy to upstream ───
    const proxyResult = await proxyService.forward(
      route,
      {
        method: req.method,
        path: upstreamPath,
        queryString,
        headers: req.headers,
        body,
      },
      ctx.requestId
    );

    // ─── 7. Bill the call ───
    // When x402 is enabled, settlement already happened in x402 middleware.
    // Only use billingService for legacy API key auth flow.
    let txRecord;
    if (!config.x402Enabled || ctx.authMode !== "x402") {
      try {
        txRecord = await billingService.processCall(ctx, route, proxyResult);
      } catch (err) {
        console.error("[Proxy] Billing error:", err);
        // Don't fail the request — billing errors are non-blocking.
      }
    }

    // ─── 7b. Record call for reliability scoring (fire-and-forget) ───
    config.reliabilityAggregator?.record(listingSlug, {
      latencyMs: proxyResult.latencyMs,
      statusCode: proxyResult.statusCode,
      timestamp: Date.now(),
    }).catch(() => {});

    // ─── 8. Send response to buyer ───
    // Set upstream response headers.
    for (const [key, value] of Object.entries(proxyResult.headers)) {
      res.setHeader(key, value);
    }

    // Add NexusX headers.
    res.setHeader("X-NexusX-Request-Id", ctx.requestId);
    res.setHeader("X-NexusX-Listing", listingSlug);
    res.setHeader("X-NexusX-Latency-Ms", proxyResult.latencyMs.toString());

    if (ctx.authMode === "x402" && ctx.x402) {
      res.setHeader("X-NexusX-Price-USDC", ctx.x402.amountUsdc.toFixed(6));
      res.setHeader("X-NexusX-Fee-USDC", ctx.x402.platformFeeUsdc.toFixed(6));
      res.setHeader("X-NexusX-Payment", "x402");
      res.setHeader("X-NexusX-TxHash", ctx.x402.txHash);
    } else if (txRecord && txRecord.priceUsdc > 0) {
      res.setHeader("X-NexusX-Price-USDC", txRecord.priceUsdc.toFixed(6));
      res.setHeader("X-NexusX-Fee-USDC", txRecord.platformFeeUsdc.toFixed(6));
    }

    if (isSandbox) {
      res.setHeader("X-NexusX-Sandbox", "true");
    }

    res.status(proxyResult.statusCode).send(proxyResult.body);
  }

  return router;
}

/**
 * Extract listing ID from the request for rate limit signals.
 * Used by the rate limiter middleware.
 */
export function extractListingSlug(req: Request): string | null {
  // Match /v1/:listingSlug/...
  const match = req.path.match(/^\/v1\/([^/]+)/);
  return match ? match[1] : null;
}
