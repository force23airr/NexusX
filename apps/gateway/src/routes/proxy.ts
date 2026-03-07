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
  ExecutionReceiptRecord,
  GatewayConfig,
  PersistedExecutionReceiptRef,
  ProxyResult,
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
  /** Persist canonical execution receipts for agent-visible call tracing. */
  persistExecutionReceipt?: (record: ExecutionReceiptRecord) => Promise<PersistedExecutionReceiptRef>;
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

  async function persistReceipt(
    record: ExecutionReceiptRecord,
  ): Promise<PersistedExecutionReceiptRef | null> {
    if (!config.persistExecutionReceipt) {
      return null;
    }
    try {
      return await config.persistExecutionReceipt(record);
    } catch (err) {
      console.error("[Proxy] Execution receipt persist error:", err, {
        requestId: record.requestId,
        listingSlug: record.listingSlug,
      });
      return null;
    }
  }

  function setExecutionHeaders(
    res: Response,
    input: {
      receiptId?: string | null;
      requestId: string;
      queryId?: string;
      listingSlug: string;
      authMode: "api_key" | "x402";
      billingMode: "individual" | "bundle_step";
      outcome: "success" | "failed" | "rejected";
      settlementStatus: "none" | "settled" | "pending_reconciliation" | "upstream_failed" | "deferred_bundle" | "abandoned";
      chargedPriceUsdc: number;
      quotedPriceUsdc: number;
      platformFeeUsdc: number;
      providerAmountUsdc: number;
      latencyMs: number;
      sandbox: boolean;
      txHash?: string | null;
      bundleSessionId?: string;
      bundleStepIndex?: number;
      circuitState?: string | null;
    },
  ): void {
    if (input.receiptId) {
      res.setHeader("X-NexusX-Receipt-Id", input.receiptId);
    }
    res.setHeader("X-NexusX-Request-Id", input.requestId);
    res.setHeader("X-NexusX-Listing", input.listingSlug);
    res.setHeader("X-NexusX-Auth-Mode", input.authMode);
    res.setHeader("X-NexusX-Receipt-Outcome", input.outcome);
    res.setHeader("X-NexusX-Billing-Mode", input.billingMode);
    res.setHeader("X-NexusX-Settlement-Status", input.settlementStatus);
    res.setHeader("X-NexusX-Price-USDC", input.chargedPriceUsdc.toFixed(6));
    res.setHeader("X-NexusX-Quoted-Price-USDC", input.quotedPriceUsdc.toFixed(6));
    res.setHeader("X-NexusX-Fee-USDC", input.platformFeeUsdc.toFixed(6));
    res.setHeader("X-NexusX-Provider-Amount-USDC", input.providerAmountUsdc.toFixed(6));
    res.setHeader("X-NexusX-Latency-Ms", Math.max(0, Math.trunc(input.latencyMs)).toString());
    if (input.queryId) {
      res.setHeader("X-NexusX-Query-Id", input.queryId);
    }
    if (input.txHash) {
      res.setHeader("X-NexusX-TxHash", input.txHash);
    }
    if (input.authMode === "x402") {
      res.setHeader("X-NexusX-Payment", "x402");
    }
    if (input.bundleSessionId) {
      res.setHeader("X-NexusX-Bundle-Session-Id", input.bundleSessionId);
    }
    if (typeof input.bundleStepIndex === "number" && Number.isFinite(input.bundleStepIndex)) {
      res.setHeader("X-NexusX-Bundle-Step-Index", String(input.bundleStepIndex));
    }
    if (input.billingMode === "bundle_step") {
      res.setHeader("X-NexusX-Bundle-Quoted-Price-USDC", input.quotedPriceUsdc.toFixed(6));
    }
    if (input.sandbox) {
      res.setHeader("X-NexusX-Sandbox", "true");
    }
    if (input.circuitState) {
      res.setHeader("X-NexusX-Circuit-State", input.circuitState);
    }
  }

  function buildBaseReceipt(
    ctx: RequestContext,
    listingSlug: string,
    queryLogId?: string,
  ): Pick<
    ExecutionReceiptRecord,
    "requestId" | "queryLogId" | "listingSlug" | "buyerId" | "payerAddress" | "authMode" | "sandbox" | "metadata"
  > {
    return {
      requestId: ctx.requestId,
      queryLogId: queryLogId ?? null,
      listingSlug,
      buyerId: ctx.authMode === "api_key" ? ctx.buyerId : null,
      payerAddress: ctx.authMode === "x402" ? ctx.buyerAddress : null,
      authMode: ctx.authMode === "x402" ? "X402" : "API_KEY",
      sandbox: ctx.isSandbox === true,
      metadata: {},
    };
  }

  async function sendGatewayResponse(
    res: Response,
    input: {
      ctx: RequestContext;
      statusCode: number;
      body: Record<string, unknown>;
      listingSlug: string;
      queryLogId?: string;
      billingMode?: "INDIVIDUAL" | "BUNDLE_STEP";
      outcome: "SUCCESS" | "FAILED" | "REJECTED";
      settlementStatus?: "NONE" | "SETTLED" | "PENDING_RECONCILIATION" | "UPSTREAM_FAILED" | "DEFERRED_BUNDLE" | "ABANDONED";
      listingId?: string | null;
      quotedPriceUsdc?: number;
      chargedPriceUsdc?: number;
      platformFeeUsdc?: number;
      providerAmountUsdc?: number;
      upstreamStatus?: number | null;
      latencyMs?: number;
      bytesTransferred?: number | null;
      txHash?: string | null;
      bundleSessionId?: string;
      bundleStepIndex?: number;
      circuitState?: string | null;
      errorCode?: string;
      errorMessage?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const receipt = await persistReceipt({
      ...buildBaseReceipt(input.ctx, input.listingSlug, input.queryLogId),
      listingId: input.listingId ?? null,
      billingMode: input.billingMode ?? "INDIVIDUAL",
      outcome: input.outcome,
      settlementStatus: input.settlementStatus ?? "NONE",
      quotedPriceUsdc: input.quotedPriceUsdc ?? 0,
      chargedPriceUsdc: input.chargedPriceUsdc ?? 0,
      platformFeeUsdc: input.platformFeeUsdc ?? 0,
      providerAmountUsdc: input.providerAmountUsdc ?? 0,
      httpStatus: input.statusCode,
      upstreamStatus: input.upstreamStatus ?? null,
      latencyMs: input.latencyMs ?? 0,
      bytesTransferred: input.bytesTransferred ?? null,
      bundleSessionId: input.bundleSessionId ?? null,
      bundleStepIndex: input.bundleStepIndex,
      txHash: input.txHash ?? null,
      circuitState: input.circuitState ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
    });

    setExecutionHeaders(res, {
      receiptId: receipt?.id ?? null,
      requestId: input.ctx.requestId,
      queryId: input.queryLogId,
      listingSlug: input.listingSlug,
      authMode: input.ctx.authMode === "x402" ? "x402" : "api_key",
      billingMode: (input.billingMode ?? "INDIVIDUAL") === "BUNDLE_STEP" ? "bundle_step" : "individual",
      outcome: input.outcome.toLowerCase() as "success" | "failed" | "rejected",
      settlementStatus: (input.settlementStatus ?? "NONE").toLowerCase() as
        "none" | "settled" | "pending_reconciliation" | "upstream_failed" | "deferred_bundle" | "abandoned",
      chargedPriceUsdc: input.chargedPriceUsdc ?? 0,
      quotedPriceUsdc: input.quotedPriceUsdc ?? 0,
      platformFeeUsdc: input.platformFeeUsdc ?? 0,
      providerAmountUsdc: input.providerAmountUsdc ?? 0,
      latencyMs: input.latencyMs ?? 0,
      sandbox: input.ctx.isSandbox === true,
      txHash: input.txHash ?? null,
      bundleSessionId: input.bundleSessionId,
      bundleStepIndex: input.bundleStepIndex,
      circuitState: input.circuitState ?? null,
    });

    res.status(input.statusCode).json({
      ...input.body,
      receiptId: receipt?.id ?? undefined,
    });
  }

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
      await sendGatewayResponse(res, {
        ctx,
        statusCode: 500,
        body: {
          error: "INTERNAL_ERROR",
          message: "Failed to resolve listing.",
          requestId: ctx.requestId,
        },
        listingSlug,
        queryLogId: discoveryQueryId,
        outcome: "FAILED",
        errorCode: "INTERNAL_ERROR",
        errorMessage: "Failed to resolve listing.",
      });
      return;
    }

    if (!route) {
      await sendGatewayResponse(res, {
        ctx,
        statusCode: 404,
        body: {
          error: "LISTING_NOT_FOUND",
          message: `No active listing found for slug: ${listingSlug}`,
          requestId: ctx.requestId,
        },
        listingSlug,
        queryLogId: discoveryQueryId,
        outcome: "REJECTED",
        errorCode: "LISTING_NOT_FOUND",
        errorMessage: `No active listing found for slug: ${listingSlug}`,
      });
      return;
    }

    // ─── 2. Check listing status ───
    if (route.status !== "ACTIVE") {
      await sendGatewayResponse(res, {
        ctx,
        statusCode: 503,
        body: {
          error: "LISTING_UNAVAILABLE",
          message: `Listing "${listingSlug}" is currently ${route.status.toLowerCase()}.`,
          requestId: ctx.requestId,
        },
        listingSlug,
        listingId: route.listingId,
        queryLogId: discoveryQueryId,
        outcome: "REJECTED",
        errorCode: "LISTING_UNAVAILABLE",
        errorMessage: `Listing "${listingSlug}" is currently ${route.status.toLowerCase()}.`,
      });
      return;
    }

    const circuitState = config.circuitBreaker
      ? await config.circuitBreaker.beforeRequest(listingSlug)
      : undefined;
    const circuitStateLabel = circuitState?.state ?? null;
    if (circuitState && circuitState.state === "open") {
      const retryAfterSeconds = Math.max(1, Math.ceil(circuitState.retryAfterMs / 1000));
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      await sendGatewayResponse(res, {
        ctx,
        statusCode: 503,
        body: {
          error: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
          message: "This provider is temporarily failing. Retry after the cooldown window.",
          requestId: ctx.requestId,
          retryAfterSeconds,
        },
        listingSlug,
        listingId: route.listingId,
        queryLogId: discoveryQueryId,
        outcome: "REJECTED",
        circuitState: circuitStateLabel,
        errorCode: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
        errorMessage: "This provider is temporarily failing. Retry after the cooldown window.",
        metadata: { retryAfterSeconds },
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
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 400,
          body: {
            error: "INVALID_BUNDLE_CONTEXT",
            message: "Bundle session billing is only supported for API key authenticated calls.",
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "INVALID_BUNDLE_CONTEXT",
          errorMessage: "Bundle session billing is only supported for API key authenticated calls.",
        });
        return;
      }

      if (!config.lookupBundleSession) {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 503,
          body: {
            error: "BUNDLE_SETTLEMENT_UNAVAILABLE",
            message: "Bundle settlement is not configured on this gateway.",
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "FAILED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "BUNDLE_SETTLEMENT_UNAVAILABLE",
          errorMessage: "Bundle settlement is not configured on this gateway.",
        });
        return;
      }

      bundleStepIndex = parseStepIndex(bundleStepIndexHeader);
      if (bundleStepIndex === undefined) {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 400,
          body: {
            error: "INVALID_BUNDLE_CONTEXT",
            message: "Missing or invalid X-NexusX-Bundle-Step-Index header.",
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "INVALID_BUNDLE_CONTEXT",
          errorMessage: "Missing or invalid X-NexusX-Bundle-Step-Index header.",
        });
        return;
      }

      const session = await config.lookupBundleSession(bundleSessionId);
      if (!session) {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 404,
          body: {
            error: "BUNDLE_SESSION_NOT_FOUND",
            message: "Bundle session was not found.",
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "BUNDLE_SESSION_NOT_FOUND",
          errorMessage: "Bundle session was not found.",
          bundleSessionId,
        });
        return;
      }

      if (session.buyerId !== ctx.buyerId) {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 403,
          body: {
            error: "BUNDLE_SESSION_FORBIDDEN",
            message: "Bundle session does not belong to this buyer.",
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "BUNDLE_SESSION_FORBIDDEN",
          errorMessage: "Bundle session does not belong to this buyer.",
          bundleSessionId,
        });
        return;
      }

      if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 409,
          body: {
            error: "BUNDLE_SESSION_EXPIRED",
            message: "Bundle session has expired.",
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "BUNDLE_SESSION_EXPIRED",
          errorMessage: "Bundle session has expired.",
          bundleSessionId,
          bundleStepIndex,
        });
        return;
      }

      if (session.status !== "REGISTERED" && session.status !== "IN_PROGRESS") {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 409,
          body: {
            error: "BUNDLE_SESSION_CLOSED",
            message: `Bundle session is ${session.status.toLowerCase()} and cannot accept step calls.`,
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "BUNDLE_SESSION_CLOSED",
          errorMessage: `Bundle session is ${session.status.toLowerCase()} and cannot accept step calls.`,
          bundleSessionId,
          bundleStepIndex,
        });
        return;
      }

      const expectedSlug = session.toolSlugs[bundleStepIndex];
      if (!expectedSlug || expectedSlug !== listingSlug) {
        await sendGatewayResponse(res, {
          ctx,
          statusCode: 400,
          body: {
            error: "BUNDLE_STEP_MISMATCH",
            message: `Bundle step ${bundleStepIndex} expected slug \"${expectedSlug ?? "n/a"}\" but received \"${listingSlug}\".`,
            requestId: ctx.requestId,
          },
          listingSlug,
          listingId: route.listingId,
          queryLogId: discoveryQueryId,
          outcome: "REJECTED",
          billingMode: "BUNDLE_STEP",
          circuitState: circuitStateLabel,
          errorCode: "BUNDLE_STEP_MISMATCH",
          errorMessage: `Bundle step ${bundleStepIndex} expected slug "${expectedSlug ?? "n/a"}" but received "${listingSlug}".`,
          bundleSessionId,
          bundleStepIndex,
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
    let proxyResult: ProxyResult;
    try {
      proxyResult = await proxyService.forward(
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to proxy request upstream.";
      if (config.circuitBreaker) {
        await config.circuitBreaker.recordResult(listingSlug, 502);
      }
      await sendGatewayResponse(res, {
        ctx,
        statusCode: 502,
        body: {
          error: "UPSTREAM_PROXY_FAILED",
          message,
          requestId: ctx.requestId,
        },
        listingSlug,
        listingId: route.listingId,
        queryLogId: discoveryQueryId,
        outcome: "FAILED",
        circuitState: circuitStateLabel,
        errorCode: "UPSTREAM_PROXY_FAILED",
        errorMessage: message,
        latencyMs: Math.max(0, Date.now() - ctx.receivedAt),
        metadata: {
          method: req.method,
          upstreamPath,
        },
      });
      return;
    }
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

    const billingMode = txRecord?.billingMode === "BUNDLE_STEP" ? "BUNDLE_STEP" : "INDIVIDUAL";
    const settlementStatus =
      ctx.authMode === "x402"
        ? (ctx.x402
            ? "SETTLED"
            : x402SettlementStatus === "pending_reconciliation"
              ? "PENDING_RECONCILIATION"
              : x402SettlementStatus === "upstream_failed"
                ? "UPSTREAM_FAILED"
                : "NONE")
        : billingMode === "BUNDLE_STEP"
          ? "DEFERRED_BUNDLE"
          : "NONE";
    const chargedPriceUsdc =
      ctx.authMode === "x402"
        ? (ctx.x402?.amountUsdc ?? (settlementStatus === "PENDING_RECONCILIATION" ? route.currentPriceUsdc : 0))
        : (txRecord?.priceUsdc ?? 0);
    const quotedPriceUsdc =
      billingMode === "BUNDLE_STEP"
        ? (txRecord?.quotedPriceUsdc ?? 0)
        : chargedPriceUsdc;
    const platformFeeUsdc =
      ctx.authMode === "x402"
        ? (ctx.x402?.platformFeeUsdc ?? (settlementStatus === "PENDING_RECONCILIATION" || settlementStatus === "UPSTREAM_FAILED"
            ? billingService.computeSplit(route.currentPriceUsdc).platformFee
            : 0))
        : (txRecord?.platformFeeUsdc ?? 0);
    const providerAmountUsdc =
      ctx.authMode === "x402"
        ? (ctx.x402?.providerAmountUsdc ?? (settlementStatus === "PENDING_RECONCILIATION" || settlementStatus === "UPSTREAM_FAILED"
            ? billingService.computeSplit(route.currentPriceUsdc).providerAmount
            : 0))
        : (txRecord?.providerAmountUsdc ?? 0);
    const receiptOutcome = proxyResult.statusCode >= 200 && proxyResult.statusCode < 400 ? "SUCCESS" : "FAILED";
    const receipt = await persistReceipt({
      ...buildBaseReceipt(ctx, listingSlug, discoveryQueryId),
      listingId: route.listingId,
      billingMode,
      outcome: receiptOutcome,
      settlementStatus,
      quotedPriceUsdc,
      chargedPriceUsdc,
      platformFeeUsdc,
      providerAmountUsdc,
      httpStatus: proxyResult.statusCode,
      upstreamStatus: proxyResult.statusCode,
      latencyMs: proxyResult.latencyMs,
      bytesTransferred: proxyResult.bytesTransferred,
      bundleSessionId: bundleSessionId ?? null,
      bundleStepIndex,
      txHash: ctx.x402?.txHash ?? null,
      circuitState: circuitStateLabel,
      errorCode: receiptOutcome === "FAILED" ? `HTTP_${proxyResult.statusCode}` : null,
      errorMessage:
        receiptOutcome === "FAILED"
          ? `Execution returned HTTP ${proxyResult.statusCode}.`
          : null,
      metadata: {
        method: req.method,
        upstreamPath,
      },
    });

    // ─── 8. Send response to buyer ───
    // Set upstream response headers.
    for (const [key, value] of Object.entries(proxyResult.headers)) {
      res.setHeader(key, value);
    }

    setExecutionHeaders(res, {
      receiptId: receipt?.id ?? null,
      requestId: ctx.requestId,
      queryId: discoveryQueryId,
      listingSlug,
      authMode: ctx.authMode === "x402" ? "x402" : "api_key",
      billingMode: billingMode === "BUNDLE_STEP" ? "bundle_step" : "individual",
      outcome: receiptOutcome.toLowerCase() as "success" | "failed" | "rejected",
      settlementStatus: settlementStatus.toLowerCase() as
        "none" | "settled" | "pending_reconciliation" | "upstream_failed" | "deferred_bundle" | "abandoned",
      chargedPriceUsdc,
      quotedPriceUsdc,
      platformFeeUsdc,
      providerAmountUsdc,
      latencyMs: proxyResult.latencyMs,
      sandbox: isSandbox,
      txHash: ctx.x402?.txHash ?? null,
      bundleSessionId,
      bundleStepIndex,
      circuitState: circuitStateLabel,
    });

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
