// ═══════════════════════════════════════════════════════════════
// NexusX — x402 Payment Middleware
// apps/gateway/src/middleware/x402Payment.ts
//
// Express middleware that enforces pay-per-request via the x402
// HTTP payment protocol. Replaces API key auth for paid calls.
//
// For each request to /v1/:listingSlug/*:
//   1. Resolve listing via RouteResolver (get current auction price)
//   2. Check for X-PAYMENT header
//   3. If missing → 402 with payment requirements
//   4. If present → verify via facilitator (settlement deferred to proxy)
//   5. On success → attach RequestContext with deferred payment info
//
// Sandbox mode (X-NexusX-Sandbox: true) bypasses payment when sandboxEnabled is true.
// ═══════════════════════════════════════════════════════════════

import { randomUUID, createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { RouteResolver } from "../services/routeResolver";
import { X402Adapter } from "../services/x402Adapter";
import type { RequestContext, DemandSignalEvent, GatewayConfig } from "../types";
import type Redis from "ioredis";
import type { AbuseMonitor } from "../services/abuseMonitor";
import { extractClientRegion } from "../utils/clientRegion";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface X402MiddlewareConfig {
  routeResolver: RouteResolver;
  emitSignal: (signal: DemandSignalEvent) => void;
  gatewayConfig: GatewayConfig;
  redis?: Redis;
  abuseMonitor?: AbuseMonitor;
}

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Creates x402 payment middleware.
 *
 * When x402 is enabled, this middleware runs before rate limiting
 * and proxying. It verifies payment or returns 402 with the
 * current auction price as the payment requirement.
 */
export function createX402PaymentMiddleware(config: X402MiddlewareConfig) {
  const { routeResolver, emitSignal, gatewayConfig, redis, abuseMonitor } = config;

  const adapter = new X402Adapter({
    facilitatorUrl: gatewayConfig.x402FacilitatorUrl,
    network: gatewayConfig.x402Network,
    platformAddress: gatewayConfig.x402PlatformAddress,
    platformFeeRate: gatewayConfig.platformFeeRate,
  });

  return async function x402PaymentMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    function setGatewayFailureHeaders(input: {
      requestId: string;
      listingSlug?: string;
      failureClass: string;
      retryable: boolean;
      billingDecision?: "not_charged";
    }): void {
      res.setHeader("X-NexusX-Request-Id", input.requestId);
      res.setHeader("X-NexusX-Failure-Class", input.failureClass);
      res.setHeader("X-NexusX-Retryable", input.retryable ? "true" : "false");
      res.setHeader("X-NexusX-Billing-Decision", input.billingDecision ?? "not_charged");
      if (input.listingSlug) {
        res.setHeader("X-NexusX-Listing", input.listingSlug);
      }
    }

    const requestId = randomUUID();
    const clientIdentity = getClientIdentity(req);
    const clientRegion = extractClientRegion(req);

    // ─── Skip if x402 is disabled ───
    if (!gatewayConfig.x402Enabled) {
      next();
      return;
    }

    // ─── Sandbox bypass (config-gated) ───
    // Only honor the sandbox header when sandboxEnabled is true in gateway config.
    // In production (sandboxEnabled: false), this header is ignored entirely.
    const isSandbox =
      gatewayConfig.sandboxEnabled &&
      req.headers["x-nexusx-sandbox"] === "true";

    if (isSandbox) {
      const ctx: RequestContext = {
        buyerId: "sandbox",
        buyerAddress: "0x0000000000000000000000000000000000000000",
        apiKeyId: "",
        rateLimitRpm: 60,
        requestId,
        receivedAt: Date.now(),
        callerCountry: clientRegion.callerCountry,
        callerRegionBucket: clientRegion.callerRegionBucket,
        authMode: "x402",
        isSandbox: true,
      };
      (req as any).ctx = ctx;
      next();
      return;
    }

    // ─── Extract listing slug ───
    // Mounted at /v1, so req.path is /:listingSlug/... — extract first segment.
    const pathSegments = req.path.split("/").filter(Boolean);
    const listingSlug = pathSegments[0];
    if (!listingSlug) {
      setGatewayFailureHeaders({
        requestId,
        failureClass: "bad_request",
        retryable: false,
      });
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "Missing listing slug in URL path.",
        requestId,
      });
      return;
    }

    if (abuseMonitor) {
      const blockState = await abuseMonitor.checkBlock("payment", clientIdentity);
      if (blockState.blocked) {
        setGatewayFailureHeaders({
          requestId,
          listingSlug,
          failureClass: "payment_abuse_blocked",
          retryable: true,
          billingDecision: "not_charged",
        });
        res.setHeader("Retry-After", Math.ceil(blockState.retryAfterMs / 1000).toString());
        res.status(429).json({
          error: "PAYMENT_ABUSE_BLOCKED",
          message: "Too many invalid or replayed payment attempts from this client.",
          requestId,
          retryAfterMs: blockState.retryAfterMs,
        });
        return;
      }
    }

    // ─── Resolve listing route (get current auction price) ───
    let route;
    try {
      route = await routeResolver.resolveBySlug(listingSlug);
    } catch (err) {
      console.error("[x402] Route resolution error:", err);
      setGatewayFailureHeaders({
        requestId,
        listingSlug,
        failureClass: "internal_error",
        retryable: true,
      });
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Failed to resolve listing.",
        requestId,
      });
      return;
    }

    if (!route) {
      setGatewayFailureHeaders({
        requestId,
        listingSlug,
        failureClass: "listing_not_found",
        retryable: false,
      });
      res.status(404).json({
        error: "LISTING_NOT_FOUND",
        message: `No active listing found for slug: ${listingSlug}`,
        requestId,
      });
      return;
    }

    if (route.status !== "ACTIVE") {
      setGatewayFailureHeaders({
        requestId,
        listingSlug,
        failureClass:
          route.status === "SUSPENDED"
            ? "provider_suspended"
            : route.status === "PAUSED"
              ? "listing_paused"
              : route.status === "DEPRECATED"
                ? "listing_deprecated"
                : "listing_unavailable",
        retryable: false,
      });
      res.status(503).json({
        error: "LISTING_UNAVAILABLE",
        message: `Listing "${listingSlug}" is currently ${route.status.toLowerCase()}.`,
        requestId,
      });
      return;
    }

    // ─── Check for X-PAYMENT header ───
    const paymentHeader = req.headers["x-payment"] as string | undefined;
    const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    if (!paymentHeader) {
      // No payment proof — return 402 with payment requirements.
      const requirement = adapter.buildPaymentRequirement(route, listingSlug, resourceUrl);

      // Emit VIEW demand signal (interest without purchase).
      emitSignal(adapter.buildViewSignal(route, requestId));

      setGatewayFailureHeaders({
        requestId,
        listingSlug,
        failureClass: "payment_required",
        retryable: true,
      });
      res.status(402).json({
        error: "PAYMENT_REQUIRED",
        message: "This API endpoint requires payment via x402 protocol.",
        requestId,
        paymentRequirements: [requirement],
        x402: {
          version: 1,
          currentPriceUsdc: route.currentPriceUsdc,
          floorPriceUsdc: route.floorPriceUsdc,
          listing: listingSlug,
          network: gatewayConfig.x402Network,
          facilitatorUrl: gatewayConfig.x402FacilitatorUrl,
        },
      });
      return;
    }

    // ─── Replay protection: reject duplicate X-Payment headers ───
    if (redis) {
      try {
        const paymentHash = createHash("sha256").update(paymentHeader).digest("hex");
        const dedupKey = `nexusx:x402:seen:${paymentHash}`;
        const wasNew = await redis.set(dedupKey, requestId, "EX", 300, "NX");
        if (!wasNew) {
          void abuseMonitor?.recordPaymentAbuse(clientIdentity, "payment_replay", listingSlug);
          setGatewayFailureHeaders({
            requestId,
            listingSlug,
            failureClass: "payment_replay",
            retryable: false,
          });
          res.status(409).json({
            error: "PAYMENT_REPLAY",
            message: "This payment proof has already been used.",
            requestId,
          });
          return;
        }
      } catch (err) {
        // Redis unavailable — allow request through (defense-in-depth)
        console.warn("[x402] Redis dedup check failed, allowing request:", err);
      }
    }

    // ─── Verify payment proof ───
    const requirement = adapter.buildPaymentRequirement(route, listingSlug, resourceUrl);
    const verifyResult = await adapter.verifyPayment(paymentHeader, requirement);

    if (!verifyResult.valid) {
      void abuseMonitor?.recordPaymentAbuse(clientIdentity, "payment_invalid", listingSlug);
      setGatewayFailureHeaders({
        requestId,
        listingSlug,
        failureClass: "payment_invalid",
        retryable: true,
      });
      res.status(402).json({
        error: "PAYMENT_INVALID",
        message: verifyResult.invalidReason || "Payment verification failed.",
        requestId,
        paymentRequirements: [requirement],
      });
      return;
    }

    // ─── Payment verified — defer settlement until upstream succeeds ───
    // Store payment proof in context so the proxy route can settle
    // after confirming the upstream returned a non-5xx response.
    const ctx: RequestContext = {
      buyerId: verifyResult.payerAddress!,
      buyerAddress: verifyResult.payerAddress!,
      apiKeyId: "",
      rateLimitRpm: route.capacityPerMinute,
      requestId,
      receivedAt: Date.now(),
      callerCountry: clientRegion.callerCountry,
      callerRegionBucket: clientRegion.callerRegionBucket,
      authMode: "x402",
      x402DeferredPayment: {
        paymentHeader,
        paymentRequirement: requirement,
        payerAddress: verifyResult.payerAddress!,
        currentPriceUsdc: route.currentPriceUsdc,
        listingSlug,
        route,
      },
    };

    (req as any).ctx = ctx;

    // Emit API_CALL demand signal.
    emitSignal(adapter.buildCallSignal(route, verifyResult.payerAddress!, requestId));

    next();
  };
}

function getClientIdentity(req: Request): string {
  const candidate = req.ip || req.socket.remoteAddress || "unknown";
  return candidate.trim() || "unknown";
}
