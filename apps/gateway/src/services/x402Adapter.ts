// ═══════════════════════════════════════════════════════════════
// NexusX — x402 Dynamic Pricing Adapter
// apps/gateway/src/services/x402Adapter.ts
//
// Bridges NexusX's dynamic auction pricing with the x402 payment
// protocol. Since @x402/express paymentMiddleware expects static
// route→price mappings, this adapter implements the x402 server-side
// verification flow manually using the facilitator client.
//
// Flow:
//   1. Check for X-PAYMENT header (x402 payment proof)
//   2. If missing → return 402 with payment requirements (current auction price)
//   3. If present → verify via facilitator, then settle
//   4. On success → attach X402PaymentContext and continue
// ═══════════════════════════════════════════════════════════════

import type { ListingRoute, DemandSignalEvent, X402PaymentContext } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface X402AdapterConfig {
  facilitatorUrl: string;
  network: string;
  /** Platform wallet that receives x402 payments. Provider payouts happen separately. */
  platformAddress: string;
  /** Platform fee rate as decimal (0.12 = 12%). */
  platformFeeRate: number;
}

/** Payment requirement returned in 402 responses. */
export interface PaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
  };
}

/** Result of verifying an x402 payment proof. */
export interface VerifyResult {
  valid: boolean;
  payerAddress?: string;
  txHash?: string;
  invalidReason?: string;
}

/** Result of settling an x402 payment. */
export interface SettleResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// ADAPTER
// ─────────────────────────────────────────────────────────────

export class X402Adapter {
  private config: X402AdapterConfig;

  constructor(config: X402AdapterConfig) {
    this.config = config;
  }

  /**
   * Build a 402 payment requirement for a listing at its current auction price.
   *
   * Payment is routed to the platform wallet (not the provider directly).
   * The platform records the fee split and pays providers separately.
   * This preserves the 12% platform fee that was handled by the billing
   * service in the old escrow flow.
   */
  buildPaymentRequirement(
    route: ListingRoute,
    listingSlug: string,
    resourceUrl: string
  ): PaymentRequirement {
    return {
      scheme: "exact",
      network: this.config.network,
      maxAmountRequired: this.toUsdcAtomicString(route.currentPriceUsdc),
      resource: resourceUrl,
      description: `NexusX API call: ${listingSlug}`,
      mimeType: "application/json",
      payTo: this.config.platformAddress,
      maxTimeoutSeconds: 30,
      asset: "USDC",
      extra: {
        name: "NexusX",
        version: "1.0.0",
      },
    };
  }

  /**
   * Compute the fee split for a given price.
   * Same logic as BillingService.computeSplit().
   */
  computeFeeSplit(priceUsdc: number): {
    platformFeeUsdc: number;
    providerAmountUsdc: number;
  } {
    const platformFeeUsdc = this.roundUsdc(priceUsdc * this.config.platformFeeRate);
    const providerAmountUsdc = this.roundUsdc(priceUsdc - platformFeeUsdc);
    return { platformFeeUsdc, providerAmountUsdc };
  }

  /**
   * Verify an x402 payment proof via the facilitator.
   */
  async verifyPayment(
    paymentHeader: string,
    paymentRequirement: PaymentRequirement
  ): Promise<VerifyResult> {
    try {
      const response = await fetch(`${this.config.facilitatorUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment: paymentHeader,
          paymentRequirements: paymentRequirement,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return { valid: false, invalidReason: `Facilitator error: ${response.status} ${body}` };
      }

      const result = await response.json();
      return {
        valid: result.valid === true,
        payerAddress: result.payerAddress,
        txHash: result.txHash,
        invalidReason: result.valid ? undefined : (result.invalidReason || "Payment verification failed"),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, invalidReason: `Facilitator unreachable: ${message}` };
    }
  }

  /**
   * Settle a verified payment via the facilitator.
   */
  async settlePayment(
    paymentHeader: string,
    paymentRequirement: PaymentRequirement
  ): Promise<SettleResult> {
    try {
      const response = await fetch(`${this.config.facilitatorUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment: paymentHeader,
          paymentRequirements: paymentRequirement,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return { success: false, error: `Settlement failed: ${response.status} ${body}` };
      }

      const result = await response.json();
      return {
        success: result.success === true,
        txHash: result.txHash,
        error: result.success ? undefined : (result.error || "Settlement failed"),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Settlement unreachable: ${message}` };
    }
  }

  /**
   * Build an X402PaymentContext from a successful verification + settlement.
   * Includes the fee split so downstream handlers know what's owed to the provider.
   */
  buildPaymentContext(
    payerAddress: string,
    amountUsdc: number,
    txHash: string,
    listingSlug: string,
    requestId: string
  ): X402PaymentContext {
    const { platformFeeUsdc, providerAmountUsdc } = this.computeFeeSplit(amountUsdc);
    return {
      payerAddress,
      amountUsdc,
      platformFeeUsdc,
      providerAmountUsdc,
      txHash,
      network: this.config.network,
      listingSlug,
      requestId,
      receivedAt: Date.now(),
    };
  }

  /**
   * Build demand signal for a successful paid call (API_CALL).
   */
  buildCallSignal(
    route: ListingRoute,
    payerAddress: string,
    requestId: string
  ): DemandSignalEvent {
    return {
      listingId: route.listingId,
      buyerId: payerAddress,
      type: "API_CALL",
      weight: 1.0,
      metadata: {
        requestId,
        priceUsdc: route.currentPriceUsdc,
        paymentMethod: "x402",
      },
    };
  }

  /**
   * Build demand signal for a 402 response (VIEW — indicates interest).
   */
  buildViewSignal(
    route: ListingRoute,
    requestId: string
  ): DemandSignalEvent {
    return {
      listingId: route.listingId,
      buyerId: "anonymous",
      type: "VIEW",
      weight: 0.2,
      metadata: {
        requestId,
        priceUsdc: route.currentPriceUsdc,
        paymentMethod: "x402",
      },
    };
  }

  /**
   * Round a USDC amount to 6 decimal places using integer math.
   */
  private roundUsdc(amount: number): number {
    return Math.round(amount * 1_000_000) / 1_000_000;
  }

  /**
   * Convert a USDC dollar amount (e.g. 0.005) to the atomic string
   * representation used by x402 (6 decimals, no decimal point).
   */
  private toUsdcAtomicString(usdcAmount: number): string {
    const atomic = Math.round(usdcAmount * 1_000_000);
    return atomic.toString();
  }
}
