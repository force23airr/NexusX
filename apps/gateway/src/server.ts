// ═══════════════════════════════════════════════════════════════
// NexusX — Gateway Server
// apps/gateway/src/server.ts
//
// Main entrypoint. Wires together all middleware and services:
//   Express app → Auth → Rate Limit → Proxy Route → Billing
//
// Non-authenticated routes: /health, /ready, /status, /pricing/*
// Authenticated routes:     /v1/:listingSlug/*
// ═══════════════════════════════════════════════════════════════

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createAuthMiddleware } from "./middleware/auth";
import { RateLimiter, createRateLimitMiddleware } from "./middleware/rateLimiter";
import { createX402PaymentMiddleware } from "./middleware/x402Payment";
import { ProxyService } from "./services/proxyService";
import { RouteResolver } from "./services/routeResolver";
import { BillingService } from "./services/billingService";
import { PriceWebSocketServer } from "./services/priceWebSocket";
import { ReliabilityAggregator } from "./services/reliability-aggregator";
import { createProxyRoute, extractListingSlug } from "./routes/proxy";
import { createHealthRoutes } from "./routes/health";
import { createPriceHistoryRoutes } from "./routes/price-history";
import type {
  GatewayConfig,
  DemandSignalEvent,
  TransactionRecord,
} from "./types";
import { DEFAULT_GATEWAY_CONFIG } from "./types";
import type { ApiKeyLookupFn, ApiKeyTouchFn } from "./middleware/auth";
import type { ListingLookupFn, ListingByIdFn } from "./services/routeResolver";
import type { TransactionPersistFn } from "./services/billingService";
import type Redis from "ioredis";
import type { PrismaClient } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** External dependencies injected at startup. */
export interface GatewayDependencies {
  /** Database: Look up API key record by prefix. */
  lookupApiKey: ApiKeyLookupFn;
  /** Database: Update API key last_used_at. */
  touchApiKey: ApiKeyTouchFn;
  /** Database: Look up listing route by slug. */
  lookupListingBySlug: ListingLookupFn;
  /** Database: Look up listing route by ID. */
  lookupListingById: ListingByIdFn;
  /** Database: Persist a transaction record. */
  persistTransaction: TransactionPersistFn;
  /** Pub/Sub: Emit demand signal to auction engine. */
  emitDemandSignal: (signal: DemandSignalEvent) => void;
  /** Redis client for price history sorted sets (optional). */
  redis?: Redis;
  /** Prisma client for price history fallback (optional). */
  prisma?: PrismaClient;
}

// ─────────────────────────────────────────────────────────────
// SERVER FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Create and configure the gateway Express app.
 *
 * @param deps   External dependencies (DB queries, pub/sub).
 * @param config Gateway configuration overrides.
 * @returns Configured Express app + cleanup function.
 */
export function createGatewayApp(
  deps: GatewayDependencies,
  config?: Partial<GatewayConfig>
) {
  const cfg: GatewayConfig = { ...DEFAULT_GATEWAY_CONFIG, ...config };
  const startedAt = Date.now();
  const app = express();

  // ─── Global middleware ───

  // Trust proxy (for X-Forwarded-For behind load balancer).
  app.set("trust proxy", true);

  // Request ID header.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Powered-By", "NexusX-Gateway");
    next();
  });

  // Body size limit.
  app.use(express.raw({
    type: "*/*",
    limit: cfg.maxBodySizeBytes,
  }));

  // ─── Services ───
  const rateLimiter = new RateLimiter();
  const proxyService = new ProxyService({ timeoutMs: cfg.upstreamTimeoutMs });
  const routeResolver = new RouteResolver(
    deps.lookupListingBySlug,
    deps.lookupListingById,
    cfg.routeCacheTtlMs
  );
  const billingService = new BillingService(
    deps.persistTransaction,
    deps.emitDemandSignal,
    { platformFeeRate: cfg.platformFeeRate }
  );
  const reliabilityAggregator = deps.redis
    ? new ReliabilityAggregator(deps.redis)
    : undefined;

  // ─── Public routes (no auth) ───
  app.use(
    createHealthRoutes({
      routeResolver,
      billingService,
      startedAt,
    })
  );

  // Price history + reliability endpoints (public, no auth required)
  if (deps.redis && deps.prisma) {
    app.use(createPriceHistoryRoutes(deps.redis, deps.prisma, reliabilityAggregator));
  }

  // ─── Auth + payment middleware ───
  const authMiddleware = createAuthMiddleware(deps.lookupApiKey, deps.touchApiKey);

  const rateLimitMiddleware = createRateLimitMiddleware(
    rateLimiter,
    deps.emitDemandSignal,
    (req: Request) => {
      const slug = extractListingSlug(req);
      // For rate limit signals, we use the slug as-is. The demand
      // tracker will resolve it to a listing ID.
      return slug;
    }
  );

  const proxyRoute = createProxyRoute({
    routeResolver,
    proxyService,
    billingService,
    emitSignal: deps.emitDemandSignal,
    x402Enabled: cfg.x402Enabled,
    reliabilityAggregator,
  });

  // Proxy routes: /v1/:listingSlug/*
  // When x402 is enabled, use x402 payment middleware instead of API key auth.
  // When disabled, fall back to the traditional API key auth flow.
  if (cfg.x402Enabled) {
    const x402Middleware = createX402PaymentMiddleware({
      routeResolver,
      emitSignal: deps.emitDemandSignal,
      gatewayConfig: cfg,
      persistTransaction: deps.persistTransaction,
    });

    app.use(
      "/v1/:listingSlug",
      x402Middleware,
      rateLimitMiddleware,
      proxyRoute
    );

    console.log("[Gateway] x402 payment protocol enabled.");
  } else {
    app.use(
      "/v1",
      authMiddleware,
      rateLimitMiddleware,
      proxyRoute
    );
  }

  // ─── 404 catch-all ───
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: "Route not found. API calls use /v1/:listingSlug/...",
    });
  });

  // ─── Global error handler ───
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Gateway] Unhandled error:", err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });

  // ─── Cleanup function ───
  function cleanup(): void {
    rateLimiter.destroy();
    routeResolver.destroy();
    console.log("[Gateway] Cleaned up resources.");
  }

  return { app, cleanup, config: cfg, rateLimiter, routeResolver, billingService };
}

// ─────────────────────────────────────────────────────────────
// STANDALONE STARTUP
// ─────────────────────────────────────────────────────────────

/**
 * Start the gateway as a standalone server.
 * In production, call createGatewayApp() directly and inject real dependencies.
 */
export function startGateway(
  deps: GatewayDependencies,
  config?: Partial<GatewayConfig>,
  priceWs?: PriceWebSocketServer,
): void {
  const { app, cleanup, config: cfg } = createGatewayApp(deps, config);

  const server = app.listen(cfg.port, async () => {
    console.log(`[Gateway] NexusX API Gateway listening on port ${cfg.port}`);
    console.log(`[Gateway] Fee rate: ${(cfg.platformFeeRate * 100).toFixed(1)}%`);
    console.log(`[Gateway] Upstream timeout: ${cfg.upstreamTimeoutMs}ms`);
    console.log(`[Gateway] Route cache TTL: ${cfg.routeCacheTtlMs}ms`);
    console.log(`[Gateway] x402 enabled: ${cfg.x402Enabled}`);
    if (cfg.x402Enabled) {
      console.log(`[Gateway] x402 facilitator: ${cfg.x402FacilitatorUrl}`);
      console.log(`[Gateway] x402 network: ${cfg.x402Network}`);
    }

    // Attach WebSocket price stream
    if (priceWs) {
      try {
        await priceWs.attach(server);
        console.log(`[Gateway] WebSocket price stream available at ws://localhost:${cfg.port}/ws/prices`);
      } catch (err) {
        console.error("[Gateway] Failed to attach WebSocket price server:", err);
      }
    }
  });

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    console.log(`[Gateway] Received ${signal}. Shutting down gracefully...`);

    if (priceWs) {
      await priceWs.destroy();
    }

    server.close(() => {
      cleanup();
      console.log("[Gateway] Server closed.");
      process.exit(0);
    });

    // Force exit after 10 seconds.
    setTimeout(() => {
      console.error("[Gateway] Forced shutdown after timeout.");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
