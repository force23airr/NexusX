// ═══════════════════════════════════════════════════════════════
// NexusX — Billing Service
// apps/gateway/src/services/billingService.ts
//
// Computes the fee split for each API call based on the current
// auction price, records the transaction, and emits demand
// signals to the auction engine.
// ═══════════════════════════════════════════════════════════════

import type {
  RequestContext,
  ListingRoute,
  ProxyResult,
  TransactionRecord,
  DemandSignalEvent,
} from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Persist a transaction record to the database. */
export type TransactionPersistFn = (record: TransactionRecord) => Promise<void>;

/** Emit a demand signal to the auction engine (via Redis pub/sub or direct). */
export type SignalEmitFn = (signal: DemandSignalEvent) => void;

export interface BillingConfig {
  /** Platform fee rate as decimal (0.12 = 12%). */
  platformFeeRate: number;
  /** USDC decimal precision. */
  usdcPrecision: number;
}

export const DEFAULT_BILLING_CONFIG: BillingConfig = {
  platformFeeRate: 0.12,
  usdcPrecision: 6,
};

export interface ProcessCallOptions {
  bundleSessionId?: string;
  bundleStepIndex?: number;
}

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class BillingService {
  private config: BillingConfig;
  private persistTransaction: TransactionPersistFn;
  private emitSignal: SignalEmitFn;

  constructor(
    persistTransaction: TransactionPersistFn,
    emitSignal: SignalEmitFn,
    config?: Partial<BillingConfig>
  ) {
    this.config = { ...DEFAULT_BILLING_CONFIG, ...config };
    this.persistTransaction = persistTransaction;
    this.emitSignal = emitSignal;
  }

  /**
   * Process billing for a completed API call.
   *
   * 1. Compute fee split (provider share + platform fee).
   * 2. Persist the transaction record.
   * 3. Emit API_CALL demand signal.
   *
   * @param ctx     Authenticated request context.
   * @param route   Resolved listing route with current price.
   * @param result  Proxy response metadata.
   */
  async processCall(
    ctx: RequestContext,
    route: ListingRoute,
    result: ProxyResult,
    options?: ProcessCallOptions
  ): Promise<TransactionRecord> {
    // Only bill for successful upstream responses (2xx/3xx).
    // 4xx/5xx from the provider are still billed — the provider
    // served a response. Gateway errors (502/504) are NOT billed.
    const isBillable = result.statusCode < 500 || result.statusCode >= 600;

    if (!isBillable || route.isSandbox) {
      // Emit VIEW-equivalent signal for sandbox calls.
      if (route.isSandbox) {
        this.emitSignal({
          listingId: route.listingId,
          buyerId: ctx.buyerId,
          type: "SANDBOX_TEST",
          weight: 0.5,
          metadata: { requestId: ctx.requestId },
        });
      }
      // Return zero-value record for tracking.
      return this.createZeroRecord(ctx, route, result, options);
    }

    // ─── Compute fee split ───
    const price = route.currentPriceUsdc;
    const platformFee = this.roundUsdc(price * this.config.platformFeeRate);
    const providerAmount = this.roundUsdc(price - platformFee);

    const isBundleStep = !!options?.bundleSessionId;
    const record: TransactionRecord = isBundleStep
      ? {
          requestId: ctx.requestId,
          listingId: route.listingId,
          buyerId: ctx.buyerId,
          status: "PENDING",
          billingMode: "BUNDLE_STEP",
          bundleSessionId: options?.bundleSessionId ?? null,
          bundleStepIndex: options?.bundleStepIndex ?? null,
          settledViaBundle: false,
          // Bundle steps are quoted here but charged once at finalization.
          priceUsdc: 0,
          platformFeeUsdc: 0,
          providerAmountUsdc: 0,
          feeRateApplied: this.config.platformFeeRate,
          quotedPriceUsdc: price,
          quotedPlatformFeeUsdc: platformFee,
          quotedProviderAmountUsdc: providerAmount,
          responseTimeMs: result.latencyMs,
          httpStatus: result.statusCode,
          bytesTransferred: result.bytesTransferred,
        }
      : {
          requestId: ctx.requestId,
          listingId: route.listingId,
          buyerId: ctx.buyerId,
          status: "CONFIRMED",
          billingMode: "INDIVIDUAL",
          settledViaBundle: false,
          priceUsdc: price,
          platformFeeUsdc: platformFee,
          providerAmountUsdc: providerAmount,
          feeRateApplied: this.config.platformFeeRate,
          responseTimeMs: result.latencyMs,
          httpStatus: result.statusCode,
          bytesTransferred: result.bytesTransferred,
        };

    // ─── Persist (fire-and-forget with error logging) ───
    this.persistTransaction(record).catch((err) =>
      console.error("[Billing] Persist error:", err, { requestId: ctx.requestId })
    );

    // ─── Emit API_CALL demand signal ───
    this.emitSignal({
      listingId: route.listingId,
      buyerId: ctx.buyerId,
      type: "API_CALL",
      weight: 1.0,
      metadata: {
        requestId: ctx.requestId,
        priceUsdc: price,
        billingMode: isBundleStep ? "bundle_step" : "individual",
        bundleSessionId: options?.bundleSessionId ?? null,
        latencyMs: result.latencyMs,
        httpStatus: result.statusCode,
      },
    });

    return record;
  }

  /**
   * Round a USDC amount to 6 decimal places using integer math
   * to avoid floating-point drift.
   */
  roundUsdc(amount: number): number {
    const factor = Math.pow(10, this.config.usdcPrecision);
    return Math.round(amount * factor) / factor;
  }

  /**
   * Compute the fee split without side effects.
   * Used by the pricing transparency endpoint.
   */
  computeSplit(priceUsdc: number): {
    price: number;
    platformFee: number;
    providerAmount: number;
    feeRate: number;
  } {
    const platformFee = this.roundUsdc(priceUsdc * this.config.platformFeeRate);
    const providerAmount = this.roundUsdc(priceUsdc - platformFee);
    return {
      price: priceUsdc,
      platformFee,
      providerAmount,
      feeRate: this.config.platformFeeRate,
    };
  }

  private createZeroRecord(
    ctx: RequestContext,
    route: ListingRoute,
    result: ProxyResult,
    options?: ProcessCallOptions
  ): TransactionRecord {
    const isBundleStep = !!options?.bundleSessionId;
    return {
      requestId: ctx.requestId,
      listingId: route.listingId,
      buyerId: ctx.buyerId,
      status: "FAILED",
      billingMode: isBundleStep ? "BUNDLE_STEP" : "INDIVIDUAL",
      bundleSessionId: options?.bundleSessionId ?? null,
      bundleStepIndex: options?.bundleStepIndex ?? null,
      settledViaBundle: false,
      priceUsdc: 0,
      platformFeeUsdc: 0,
      providerAmountUsdc: 0,
      feeRateApplied: 0,
      responseTimeMs: result.latencyMs,
      httpStatus: result.statusCode,
      bytesTransferred: result.bytesTransferred,
    };
  }
}
