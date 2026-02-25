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
//   4. If present → verify + settle via facilitator
//   5. On success → attach RequestContext with x402 payment info
//
// Sandbox mode (X-NexusX-Sandbox: true) bypasses payment.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { RouteResolver } from "../services/routeResolver";
import { X402Adapter } from "../services/x402Adapter";
import type { TransactionPersistFn } from "../services/billingService";
import type { RequestContext, DemandSignalEvent, GatewayConfig, TransactionRecord } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface X402MiddlewareConfig {
  routeResolver: RouteResolver;
  emitSignal: (signal: DemandSignalEvent) => void;
  gatewayConfig: GatewayConfig;
  /** Persist transaction records so provider payouts can be computed. */
  persistTransaction: TransactionPersistFn;
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
  const { routeResolver, emitSignal, gatewayConfig, persistTransaction } = config;

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
    const requestId = randomUUID();

    // ─── Skip if x402 is disabled ───
    if (!gatewayConfig.x402Enabled) {
      next();
      return;
    }

    // ─── Sandbox bypass ───
    const isSandbox = req.headers["x-nexusx-sandbox"] === "true";
    if (isSandbox) {
      // Attach minimal context for sandbox mode.
      const ctx: RequestContext = {
        buyerId: "sandbox",
        buyerAddress: "0x0000000000000000000000000000000000000000",
        apiKeyId: "",
        rateLimitRpm: 60,
        requestId,
        receivedAt: Date.now(),
        authMode: "x402",
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
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "Missing listing slug in URL path.",
        requestId,
      });
      return;
    }

    // ─── Resolve listing route (get current auction price) ───
    let route;
    try {
      route = await routeResolver.resolveBySlug(listingSlug);
    } catch (err) {
      console.error("[x402] Route resolution error:", err);
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Failed to resolve listing.",
        requestId,
      });
      return;
    }

    if (!route) {
      res.status(404).json({
        error: "LISTING_NOT_FOUND",
        message: `No active listing found for slug: ${listingSlug}`,
        requestId,
      });
      return;
    }

    if (route.status !== "ACTIVE") {
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

    // ─── Verify payment proof ───
    const requirement = adapter.buildPaymentRequirement(route, listingSlug, resourceUrl);
    const verifyResult = await adapter.verifyPayment(paymentHeader, requirement);

    if (!verifyResult.valid) {
      res.status(402).json({
        error: "PAYMENT_INVALID",
        message: verifyResult.invalidReason || "Payment verification failed.",
        requestId,
        paymentRequirements: [requirement],
      });
      return;
    }

    // ─── Settle payment ───
    const settleResult = await adapter.settlePayment(paymentHeader, requirement);

    if (!settleResult.success) {
      console.error("[x402] Settlement failed:", settleResult.error, { requestId });
      res.status(402).json({
        error: "PAYMENT_SETTLEMENT_FAILED",
        message: settleResult.error || "Payment settlement failed.",
        requestId,
        paymentRequirements: [requirement],
      });
      return;
    }

    // ─── Payment verified + settled — attach context ───
    const paymentContext = adapter.buildPaymentContext(
      verifyResult.payerAddress!,
      route.currentPriceUsdc,
      settleResult.txHash || verifyResult.txHash || "",
      listingSlug,
      requestId
    );

    const ctx: RequestContext = {
      buyerId: verifyResult.payerAddress!,
      buyerAddress: verifyResult.payerAddress!,
      apiKeyId: "",
      rateLimitRpm: route.capacityPerMinute,
      requestId,
      receivedAt: Date.now(),
      authMode: "x402",
      x402: paymentContext,
    };

    (req as any).ctx = ctx;

    // Emit API_CALL demand signal.
    emitSignal(adapter.buildCallSignal(route, verifyResult.payerAddress!, requestId));

    // Persist transaction record for provider payout tracking.
    // The full payment went to the platform wallet; this record
    // tracks how much is owed to the provider.
    const txRecord: TransactionRecord = {
      requestId,
      listingId: route.listingId,
      buyerId: verifyResult.payerAddress!,
      priceUsdc: route.currentPriceUsdc,
      platformFeeUsdc: paymentContext.platformFeeUsdc,
      providerAmountUsdc: paymentContext.providerAmountUsdc,
      feeRateApplied: gatewayConfig.platformFeeRate,
      responseTimeMs: 0, // Updated after proxy completes (downstream)
      httpStatus: 0,     // Updated after proxy completes (downstream)
      bytesTransferred: 0,
    };
    persistTransaction(txRecord).catch((err) =>
      console.error("[x402] Transaction persist error:", err, { requestId })
    );

    next();
  };
}
