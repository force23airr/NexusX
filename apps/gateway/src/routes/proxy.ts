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

import { createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import type {
  RequestContext,
  ListingRoute,
  DemandSignalEvent,
  BundleSessionRecord,
  TransactionRecord,
  X402ExecutionRecord,
  GatewayConfig,
} from "../types";
import type { RouteResolver } from "../services/routeResolver";
import type { ProxyService } from "../services/proxyService";
import type { BillingService, TransactionPersistFn } from "../services/billingService";
import type { ReliabilityAggregator } from "../services/reliability-aggregator";
import type { CredentialService } from "../services/credentialService";
import type { CircuitBreakerService } from "../services/circuitBreaker";
import { X402Adapter, type PaymentRequirement } from "../services/x402Adapter";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ProxyRouteConfig {
  routeResolver: RouteResolver;
  proxyService: ProxyService;
  billingService: BillingService;
  lookupBundleSession?: (bundleSessionId: string) => Promise<BundleSessionRecord | null>;
  emitSignal: (signal: DemandSignalEvent) => void;
  /** When true, x402 handles billing — skip billingService.processCall(). */
  x402Enabled?: boolean;
  /** Records call results for real-time reliability scoring. */
  reliabilityAggregator?: ReliabilityAggregator;
  /** Injects upstream provider credentials per listing slug. */
  credentialService?: CredentialService;
  /** Fails fast when an upstream is repeatedly returning 5xx responses. */
  circuitBreaker?: CircuitBreakerService;
  /** Gateway config for x402 deferred settlement. */
  gatewayConfig?: GatewayConfig;
  /** Persist transaction records (for x402 deferred settlement). */
  persistTransaction?: TransactionPersistFn;
  /** Persist x402 execution settlement state for reconciliation. */
  persistX402Execution?: (record: X402ExecutionRecord) => Promise<void>;
  /** Mark a discovery query as converted once execution reaches the provider. */
  markQuerySelection?: (input: {
    queryLogId: string;
    listingId: string;
    buyerId?: string;
  }) => Promise<boolean>;
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
  const { routeResolver, proxyService, billingService } = config;

  // ─── Catch-all handler for all methods ───
  router.all("/:listingSlug/*", handleProxy);
  router.all("/:listingSlug", handleProxy);
  router.all("/v1/:listingSlug/*", handleProxy);
  router.all("/v1/:listingSlug", handleProxy);

  async function handleProxy(req: Request, res: Response): Promise<void> {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    const discoveryQueryId = parseQueryIdHeader(req.headers["x-nexusx-query-id"]);
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

    const circuitState = config.circuitBreaker
      ? await config.circuitBreaker.beforeRequest(listingSlug)
      : undefined;
    if (circuitState && circuitState.state === "open") {
      const retryAfterSeconds = Math.max(1, Math.ceil(circuitState.retryAfterMs / 1000));
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      res.status(503).json({
        error: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
        message: "This provider is temporarily failing. Retry after the cooldown window.",
        requestId: ctx.requestId,
        retryAfterSeconds,
      });
      return;
    }

    // ─── 3. Determine sandbox mode ───
    // Trust only validated sources: ctx.isSandbox (set by middleware after config check)
    // or route.isSandbox (database-driven, from listing.sandboxUrl).
    // NEVER trust the raw X-NexusX-Sandbox request header here.
    const isSandbox = ctx.isSandbox === true || route.isSandbox;
    if (ctx.isSandbox && !route.isSandbox) {
      route = { ...route, isSandbox: true };
    }

    // ─── 3b. Validate optional bundle context headers ───
    const bundleSessionId = getHeaderValue(req.headers["x-nexusx-bundle-session-id"]);
    const bundleStepIndexHeader = getHeaderValue(req.headers["x-nexusx-bundle-step-index"]);
    let bundleStepIndex: number | undefined;

    if (bundleSessionId) {
      if (ctx.authMode === "x402") {
        res.status(400).json({
          error: "INVALID_BUNDLE_CONTEXT",
          message: "Bundle session billing is only supported for API key authenticated calls.",
          requestId: ctx.requestId,
        });
        return;
      }

      if (!config.lookupBundleSession) {
        res.status(503).json({
          error: "BUNDLE_SETTLEMENT_UNAVAILABLE",
          message: "Bundle settlement is not configured on this gateway.",
          requestId: ctx.requestId,
        });
        return;
      }

      bundleStepIndex = parseStepIndex(bundleStepIndexHeader);
      if (bundleStepIndex === undefined) {
        res.status(400).json({
          error: "INVALID_BUNDLE_CONTEXT",
          message: "Missing or invalid X-NexusX-Bundle-Step-Index header.",
          requestId: ctx.requestId,
        });
        return;
      }

      const session = await config.lookupBundleSession(bundleSessionId);
      if (!session) {
        res.status(404).json({
          error: "BUNDLE_SESSION_NOT_FOUND",
          message: "Bundle session was not found.",
          requestId: ctx.requestId,
        });
        return;
      }

      if (session.buyerId !== ctx.buyerId) {
        res.status(403).json({
          error: "BUNDLE_SESSION_FORBIDDEN",
          message: "Bundle session does not belong to this buyer.",
          requestId: ctx.requestId,
        });
        return;
      }

      if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
        res.status(409).json({
          error: "BUNDLE_SESSION_EXPIRED",
          message: "Bundle session has expired.",
          requestId: ctx.requestId,
        });
        return;
      }

      if (session.status !== "REGISTERED" && session.status !== "IN_PROGRESS") {
        res.status(409).json({
          error: "BUNDLE_SESSION_CLOSED",
          message: `Bundle session is ${session.status.toLowerCase()} and cannot accept step calls.`,
          requestId: ctx.requestId,
        });
        return;
      }

      const expectedSlug = session.toolSlugs[bundleStepIndex];
      if (!expectedSlug || expectedSlug !== listingSlug) {
        res.status(400).json({
          error: "BUNDLE_STEP_MISMATCH",
          message: `Bundle step ${bundleStepIndex} expected slug \"${expectedSlug ?? "n/a"}\" but received \"${listingSlug}\".`,
          requestId: ctx.requestId,
        });
        return;
      }
    }

    // ─── 4. Extract upstream path ───
    // /v1/openai-gpt4/chat/completions → /chat/completions
    const fullPath = req.params[0] || "";
    const upstreamPath = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
    const queryString = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?") + 1)
      : "";

    // ─── 5. Collect request body ───
    const body = Buffer.isBuffer((req as any).body) && (req as any).body.length > 0
      ? (req as any).body as Buffer
      : undefined;

    // ─── 6. Proxy to upstream ───
    const credential = config.credentialService?.getCredential(listingSlug);
    const proxyResult = await proxyService.forward(
      route,
      {
        method: req.method,
        path: upstreamPath,
        queryString,
        headers: req.headers,
        body,
      },
      ctx.requestId,
      credential
    );
    if (config.circuitBreaker) {
      await config.circuitBreaker.recordResult(listingSlug, proxyResult.statusCode);
    }

    let x402SettlementStatus: "settled" | "pending_reconciliation" | "upstream_failed" | undefined;

    // ─── 6b. Settle deferred x402 payment (pay-on-success) ───
    // If the middleware verified an x402 payment but deferred settlement,
    // settle now only if the upstream returned a non-5xx status.
    if (ctx.x402DeferredPayment && proxyResult.statusCode < 500) {
      const deferred = ctx.x402DeferredPayment;
      const paymentHeaderHash = createHash("sha256").update(deferred.paymentHeader).digest("hex");
      const split = billingService.computeSplit(deferred.currentPriceUsdc);
      const adapter = new X402Adapter({
        facilitatorUrl: config.gatewayConfig?.x402FacilitatorUrl || "",
        network: config.gatewayConfig?.x402Network || "",
        platformAddress: config.gatewayConfig?.x402PlatformAddress || "",
        platformFeeRate: config.gatewayConfig?.platformFeeRate || 0.12,
      });

      const settleResult = await adapter.settlePayment(
        deferred.paymentHeader,
        deferred.paymentRequirement as PaymentRequirement
      );

      if (settleResult.success) {
        x402SettlementStatus = "settled";
        // Build x402 context now that settlement is complete.
        const paymentContext = adapter.buildPaymentContext(
          deferred.payerAddress,
          deferred.currentPriceUsdc,
          settleResult.txHash || "",
          deferred.listingSlug,
          ctx.requestId
        );
        ctx.x402 = paymentContext;

        if (config.persistX402Execution) {
          const settledRecord: X402ExecutionRecord = {
            requestId: ctx.requestId,
            listingId: route.listingId,
            listingSlug: deferred.listingSlug,
            payerAddress: deferred.payerAddress,
            paymentHeaderHash,
            paymentHeader: null,
            paymentRequirement: deferred.paymentRequirement,
            status: "SETTLED",
            quotedPriceUsdc: deferred.currentPriceUsdc,
            platformFeeUsdc: paymentContext.platformFeeUsdc,
            providerAmountUsdc: paymentContext.providerAmountUsdc,
            upstreamStatus: proxyResult.statusCode,
            responseTimeMs: proxyResult.latencyMs,
            bytesTransferred: proxyResult.bytesTransferred,
            txHash: settleResult.txHash || null,
          };
          try {
            await config.persistX402Execution(settledRecord);
          } catch (err) {
            console.error("[Proxy] x402 settlement ledger persist error:", err, { requestId: ctx.requestId });
          }
        }

        console.log(`[Proxy] x402 settled after success: ${settleResult.txHash} (${deferred.listingSlug})`);
      } else {
        x402SettlementStatus = "pending_reconciliation";
        if (config.persistX402Execution) {
          const pendingRecord: X402ExecutionRecord = {
            requestId: ctx.requestId,
            listingId: route.listingId,
            listingSlug: deferred.listingSlug,
            payerAddress: deferred.payerAddress,
            paymentHeaderHash,
            paymentHeader: deferred.paymentHeader,
            paymentRequirement: deferred.paymentRequirement,
            status: "SETTLEMENT_PENDING",
            quotedPriceUsdc: split.price,
            platformFeeUsdc: split.platformFee,
            providerAmountUsdc: split.providerAmount,
            upstreamStatus: proxyResult.statusCode,
            responseTimeMs: proxyResult.latencyMs,
            bytesTransferred: proxyResult.bytesTransferred,
            lastError: settleResult.error || "Settlement failed",
          };
          try {
            await config.persistX402Execution(pendingRecord);
          } catch (err) {
            console.error("[Proxy] x402 reconciliation persist error:", err, { requestId: ctx.requestId });
          }
        }
        console.error(`[Proxy] x402 post-success settlement failed: ${settleResult.error}`, { requestId: ctx.requestId });
        // Upstream succeeded but payment settlement failed — return the response
        // with a truthful settlement status header so callers know reconciliation is pending.
      }
    } else if (ctx.x402DeferredPayment && proxyResult.statusCode >= 500) {
      x402SettlementStatus = "upstream_failed";
      if (config.persistX402Execution) {
        const deferred = ctx.x402DeferredPayment;
        const paymentHeaderHash = createHash("sha256").update(deferred.paymentHeader).digest("hex");
        const split = billingService.computeSplit(deferred.currentPriceUsdc);
        const upstreamFailedRecord: X402ExecutionRecord = {
          requestId: ctx.requestId,
          listingId: route.listingId,
          listingSlug: deferred.listingSlug,
          payerAddress: deferred.payerAddress,
          paymentHeaderHash,
          paymentHeader: null,
          paymentRequirement: deferred.paymentRequirement,
          status: "UPSTREAM_FAILED",
          quotedPriceUsdc: split.price,
          platformFeeUsdc: split.platformFee,
          providerAmountUsdc: split.providerAmount,
          upstreamStatus: proxyResult.statusCode,
          responseTimeMs: proxyResult.latencyMs,
          bytesTransferred: proxyResult.bytesTransferred,
          lastError: `Upstream returned ${proxyResult.statusCode}`,
        };
        try {
          await config.persistX402Execution(upstreamFailedRecord);
        } catch (err) {
          console.error("[Proxy] x402 upstream-failure ledger persist error:", err, { requestId: ctx.requestId });
        }
      }
      // Upstream failed — do NOT settle. Buyer keeps their USDC.
      console.log(`[Proxy] x402 NOT settled — upstream returned ${proxyResult.statusCode} (${ctx.x402DeferredPayment.listingSlug})`);
    }

    // ─── 7. Bill the call ───
    // When x402 is enabled, settlement happened above (deferred).
    // Only use billingService for legacy API key auth flow.
    let txRecord;
    if (!config.x402Enabled || ctx.authMode !== "x402") {
      try {
        txRecord = await billingService.processCall(
          ctx,
          route,
          proxyResult,
          bundleSessionId
            ? {
                bundleSessionId,
                bundleStepIndex,
              }
            : undefined,
        );
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

    if (discoveryQueryId && proxyResult.statusCode < 500 && config.markQuerySelection) {
      config.markQuerySelection({
        queryLogId: discoveryQueryId,
        listingId: route.listingId,
        buyerId: ctx.authMode === "api_key" ? ctx.buyerId : undefined,
      }).catch((err) => {
        console.error("[Proxy] Failed to mark discovery conversion:", err, {
          requestId: ctx.requestId,
          queryId: discoveryQueryId,
        });
      });
    }

    // ─── 8. Send response to buyer ───
    // Set upstream response headers.
    for (const [key, value] of Object.entries(proxyResult.headers)) {
      res.setHeader(key, value);
    }

    // Add NexusX headers.
    res.setHeader("X-NexusX-Request-Id", ctx.requestId);
    res.setHeader("X-NexusX-Listing", listingSlug);
    res.setHeader("X-NexusX-Latency-Ms", proxyResult.latencyMs.toString());
    res.setHeader("X-NexusX-Billing-Mode", txRecord?.billingMode === "BUNDLE_STEP" ? "bundle_step" : "individual");

    if (ctx.authMode === "x402" && ctx.x402) {
      res.setHeader("X-NexusX-Price-USDC", ctx.x402.amountUsdc.toFixed(6));
      res.setHeader("X-NexusX-Fee-USDC", ctx.x402.platformFeeUsdc.toFixed(6));
      res.setHeader("X-NexusX-Payment", "x402");
      res.setHeader("X-NexusX-TxHash", ctx.x402.txHash);
      res.setHeader("X-NexusX-Settlement-Status", "settled");
    } else if (ctx.authMode === "x402" && x402SettlementStatus) {
      res.setHeader("X-NexusX-Payment", "x402");
      res.setHeader("X-NexusX-Settlement-Status", x402SettlementStatus);
    } else if (txRecord?.billingMode === "BUNDLE_STEP") {
      res.setHeader("X-NexusX-Price-USDC", "0.000000");
      res.setHeader("X-NexusX-Fee-USDC", "0.000000");
      res.setHeader(
        "X-NexusX-Bundle-Quoted-Price-USDC",
        (txRecord.quotedPriceUsdc ?? 0).toFixed(6),
      );
      if (bundleSessionId) {
        res.setHeader("X-NexusX-Bundle-Session-Id", bundleSessionId);
      }
      if (bundleStepIndex !== undefined) {
        res.setHeader("X-NexusX-Bundle-Step-Index", String(bundleStepIndex));
      }
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

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  if (!header) return undefined;
  if (Array.isArray(header)) {
    return header.length > 0 ? header[0] : undefined;
  }
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseQueryIdHeader(header: string | string[] | undefined): string | undefined {
  const value = getHeaderValue(header);
  if (!value) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function parseStepIndex(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}
