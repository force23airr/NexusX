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
import { corsMiddleware } from "./middleware/cors";
import { createAuthMiddleware } from "./middleware/auth";
import { RateLimiter, createRateLimitMiddleware } from "./middleware/rateLimiter";
import { createX402PaymentMiddleware } from "./middleware/x402Payment";
import { ProxyService } from "./services/proxyService";
import { RouteResolver } from "./services/routeResolver";
import { BillingService } from "./services/billingService";
import { CredentialService } from "./services/credentialService";
import { PriceWebSocketServer } from "./services/priceWebSocket";
import { ReliabilityAggregator } from "./services/reliability-aggregator";
import { CircuitBreakerService } from "./services/circuitBreaker";
import { createProxyRoute, extractListingSlug } from "./routes/proxy";
import { createBundleSessionRoutes } from "./routes/bundle-sessions";
import { createHealthRoutes } from "./routes/health";
import type { ReadinessCheckResult } from "./routes/health";
import { createPriceHistoryRoutes } from "./routes/price-history";
import { QualityMonitorWorker, loadQualityMonitorConfig } from "./workers/qualityMonitor";
import { IndexingWorker, loadIndexingWorkerConfig } from "./workers/indexingWorker";
import { X402SettlementWorker, loadX402SettlementWorkerConfig } from "./workers/x402SettlementWorker";
import type {
  GatewayConfig,
  DemandSignalEvent,
  TransactionRecord,
  X402ExecutionRecord,
  ExecutionReceiptRecord,
  PersistedExecutionReceiptRef,
  BundleSessionRegistrationInput,
  BundleSessionRecord,
  BundleSessionFinalizeResult,
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
  /** Database: Persist x402 execution settlement state (optional). */
  persistX402Execution?: (record: X402ExecutionRecord) => Promise<void>;
  /** Database: Persist canonical execution receipts. */
  persistExecutionReceipt?: (
    record: ExecutionReceiptRecord
  ) => Promise<PersistedExecutionReceiptRef>;
  /** Observability: mark a discovery query as having converted into execution. */
  markQuerySelection?: (input: {
    queryLogId: string;
    listingId: string;
    buyerId?: string;
  }) => Promise<boolean>;
  /** Shared control plane: current route config version (optional). */
  loadRouteVersion?: () => Promise<number | null>;
  /** Shared control plane: bump listing degradation version on global state changes. */
  bumpListingDegradationVersion?: () => Promise<number>;
  /** Runtime health check for the database dependency. */
  checkDatabaseHealth?: () => Promise<ReadinessCheckResult>;
  /** Runtime health check for the Redis dependency. */
  checkRedisHealth?: () => Promise<ReadinessCheckResult>;
  /** Database: Register a pre-execution bundle session. */
  registerBundleSession?: (
    input: BundleSessionRegistrationInput
  ) => Promise<BundleSessionRecord>;
  /** Database: Resolve a bundle session for proxy-step validation. */
  lookupBundleSession?: (bundleSessionId: string) => Promise<BundleSessionRecord | null>;
  /** Database: Finalize a bundle session with one-time settlement. */
  finalizeBundleSession?: (input: {
    bundleSessionId: string;
    buyerId: string;
  }) => Promise<BundleSessionFinalizeResult>;
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

  // CORS — must be first so OPTIONS preflights bypass auth/payment.
  app.use(corsMiddleware);

  // Trust only the first proxy hop (the load balancer directly in front of the gateway).
  app.set("trust proxy", 1);

  // Disable server fingerprinting.
  app.disable("x-powered-by");

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
    cfg.routeCacheTtlMs,
    deps.loadRouteVersion,
  );
  const billingService = new BillingService(
    deps.persistTransaction,
    deps.emitDemandSignal,
    { platformFeeRate: cfg.platformFeeRate }
  );
  const reliabilityAggregator = deps.redis
    ? new ReliabilityAggregator(deps.redis)
    : undefined;
  const credentialService = new CredentialService();
  const circuitBreaker = new CircuitBreakerService({
    enabled: cfg.circuitBreakerEnabled,
    failureThreshold: cfg.circuitBreakerFailureThreshold,
    cooldownMs: cfg.circuitBreakerCooldownMs,
    probeTtlMs: Math.max(cfg.upstreamTimeoutMs + 5_000, 45_000),
  }, deps.redis, async ({ previousState, nextState }) => {
    if (deps.bumpListingDegradationVersion && previousState !== nextState) {
      await deps.bumpListingDegradationVersion();
    }
  });

  // ─── Public routes (no auth) ───
  app.use(
    createHealthRoutes({
      routeResolver,
      billingService,
      startedAt,
      readinessChecks: {
        ...(deps.checkDatabaseHealth ? { database: deps.checkDatabaseHealth } : {}),
        ...(deps.checkRedisHealth ? { redis: deps.checkRedisHealth } : {}),
        ...(cfg.x402Enabled
          ? {
              x402: async (): Promise<ReadinessCheckResult> => ({
                ok: Boolean(cfg.x402FacilitatorUrl && cfg.x402PlatformAddress),
                message:
                  cfg.x402FacilitatorUrl && cfg.x402PlatformAddress
                    ? undefined
                    : "configuration_invalid",
              }),
            }
          : {}),
      },
    })
  );

  // Price history + reliability endpoints (public, no auth required)
  if (deps.redis && deps.prisma) {
    app.use(createPriceHistoryRoutes(deps.redis, deps.prisma, reliabilityAggregator));
  }

  // ─── Auth + payment middleware ───
  const authMiddleware = createAuthMiddleware(deps.lookupApiKey, deps.touchApiKey);

  // Bundle session lifecycle endpoints (API key auth).
  if (deps.registerBundleSession && deps.lookupBundleSession && deps.finalizeBundleSession) {
    app.use(
      "/bundle-sessions",
      authMiddleware,
      createBundleSessionRoutes({
        registerBundleSession: deps.registerBundleSession,
        lookupBundleSession: deps.lookupBundleSession,
        finalizeBundleSession: deps.finalizeBundleSession,
        defaultBundlePlatformFeeRate: cfg.bundlePlatformFeeRate,
        defaultSessionTtlMs: cfg.bundleSessionTtlMs,
      }),
    );
  }

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
    lookupBundleSession: deps.lookupBundleSession,
    emitSignal: deps.emitDemandSignal,
    x402Enabled: cfg.x402Enabled,
    reliabilityAggregator,
    credentialService,
    circuitBreaker,
    gatewayConfig: cfg,
    persistTransaction: deps.persistTransaction,
    persistX402Execution: deps.persistX402Execution,
    persistExecutionReceipt: deps.persistExecutionReceipt,
    markQuerySelection: deps.markQuerySelection,
  });

  // Proxy routes: /v1/:listingSlug/*
  // When x402 is enabled, use x402 payment middleware instead of API key auth.
  // When disabled, fall back to the traditional API key auth flow.
  if (cfg.x402Enabled) {
    const x402Middleware = createX402PaymentMiddleware({
      routeResolver,
      emitSignal: deps.emitDemandSignal,
      gatewayConfig: cfg,
      redis: deps.redis,
    });

    app.use(
      "/v1",
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

  return { app, cleanup, config: cfg, rateLimiter, routeResolver, billingService, reliabilityAggregator };
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
  const { app, cleanup, config: cfg, reliabilityAggregator } = createGatewayApp(deps, config);
  let qualityMonitor: QualityMonitorWorker | undefined;
  let indexingWorker: IndexingWorker | undefined;
  let x402SettlementWorker: X402SettlementWorker | undefined;

  const server = app.listen(cfg.port, async () => {
    console.log(`[Gateway] NexusX API Gateway listening on port ${cfg.port}`);
    console.log(`[Gateway] Fee rate: ${(cfg.platformFeeRate * 100).toFixed(1)}%`);
    console.log(`[Gateway] Bundle fee rate: ${(cfg.bundlePlatformFeeRate * 100).toFixed(1)}%`);
    console.log(`[Gateway] Upstream timeout: ${cfg.upstreamTimeoutMs}ms`);
    console.log(`[Gateway] Route cache TTL: ${cfg.routeCacheTtlMs}ms`);
    console.log(`[Gateway] x402 enabled: ${cfg.x402Enabled}`);
    console.log(
      `[Gateway] Circuit breaker: ${cfg.circuitBreakerEnabled ? "enabled" : "disabled"} ` +
      `(threshold=${cfg.circuitBreakerFailureThreshold}, cooldown=${cfg.circuitBreakerCooldownMs}ms)`,
    );
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

    // Start quality monitor worker
    if (deps.prisma && reliabilityAggregator) {
      const monitorConfig = loadQualityMonitorConfig();
      qualityMonitor = new QualityMonitorWorker(deps.prisma, reliabilityAggregator, monitorConfig);
      qualityMonitor.start();
    }

    // Start indexing worker
    if (deps.prisma) {
      const indexingConfig = loadIndexingWorkerConfig();
      indexingWorker = new IndexingWorker(deps.prisma, deps.redis, indexingConfig);
      indexingWorker.start();
    }

    if (deps.prisma && cfg.x402Enabled) {
      const x402WorkerConfig = loadX402SettlementWorkerConfig();
      x402SettlementWorker = new X402SettlementWorker(deps.prisma, cfg, x402WorkerConfig);
      x402SettlementWorker.start();
    }
  });

  server.requestTimeout = Math.max(cfg.upstreamTimeoutMs + 5_000, 45_000);
  server.headersTimeout = Math.max(server.requestTimeout + 5_000, 60_000);
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    console.log(`[Gateway] Received ${signal}. Shutting down gracefully...`);

    if (qualityMonitor) {
      qualityMonitor.stop();
    }
    if (indexingWorker) {
      indexingWorker.stop();
    }
    if (x402SettlementWorker) {
      x402SettlementWorker.stop();
    }

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
